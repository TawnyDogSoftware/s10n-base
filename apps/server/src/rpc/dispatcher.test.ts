import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { defineRpc, ERROR_CODES } from "@s10n-base/contracts";

import {
  type Actor,
  RpcFailure,
  authorize,
  createRpcDispatcher,
  defineHandler,
  type RpcCallContext,
} from "./dispatcher";

const Payload = Schema.Struct({ count: Schema.FiniteFromString });
const Result = Schema.Struct({ doubled: Schema.NumberFromString });

const publicEcho = defineRpc({
  method: "fixture.public",
  auth: "public",
  payload: Payload,
  success: Result,
});
const sessionEcho = defineRpc({
  method: "fixture.session",
  auth: "session",
  payload: Payload,
  success: Result,
});
const adminEcho = defineRpc({
  method: "fixture.admin",
  auth: { role: "admin" },
  payload: Payload,
  success: Result,
});

const anonymous: Actor = { kind: "anonymous" };
const user: Actor = { kind: "user", userId: "u1", role: "user" };
const admin: Actor = { kind: "user", userId: "a1", role: "admin" };

function double(contract: typeof publicEcho) {
  return defineHandler(contract, ({ count }) => Promise.resolve({ doubled: count * 2 }));
}

function setup(
  actor: Actor,
  handlers = [double(publicEcho), double(sessionEcho), double(adminEcho)],
) {
  const resolveActor = vi.fn(() => Promise.resolve(actor));
  const dispatch = createRpcDispatcher({ handlers, resolveActor });
  const context = { requestId: "r1" } as RpcCallContext;
  return {
    dispatch: (method: string, payload: unknown) => dispatch({ method, payload }, context),
    resolveActor,
  };
}

describe("authorize", () => {
  it.each([
    ["public", anonymous, null],
    ["public", user, null],
    ["session", anonymous, 401],
    ["session", user, null],
    ["session", admin, null],
    [{ role: "admin" }, anonymous, 401],
    [{ role: "admin" }, user, 403],
    [{ role: "admin" }, admin, null],
    [{ role: "user" }, user, null],
  ] as const)("%j for %j is %s", (auth, actor, status) => {
    expect(authorize(auth, actor)?.status ?? null).toBe(status);
  });
});

describe("createRpcDispatcher", () => {
  it("decodes the payload, runs the handler and encodes the result", async () => {
    const { dispatch } = setup(anonymous);

    expect(await dispatch("fixture.public", { count: "21" })).toEqual({
      status: 200,
      body: { ok: true, data: { doubled: "42" } },
    });
  });

  it("answers 404 for an unknown method without resolving the caller", async () => {
    const { dispatch, resolveActor } = setup(anonymous);

    const response = await dispatch("fixture.nope", {});

    expect(response).toMatchObject({
      status: 404,
      body: { ok: false, error: { code: ERROR_CODES.methodNotFound } },
    });
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it("answers 401 to an anonymous caller of a session method", async () => {
    const { dispatch } = setup(anonymous);

    expect(await dispatch("fixture.session", { count: "1" })).toMatchObject({
      status: 401,
      body: { ok: false, error: { code: ERROR_CODES.unauthenticated } },
    });
  });

  it("answers 401 to an anonymous caller of a role method", async () => {
    const { dispatch } = setup(anonymous);

    expect((await dispatch("fixture.admin", { count: "1" })).status).toBe(401);
  });

  it("answers 403 to a user calling an admin method", async () => {
    const { dispatch } = setup(user);

    expect(await dispatch("fixture.admin", { count: "1" })).toMatchObject({
      status: 403,
      body: { ok: false, error: { code: ERROR_CODES.forbidden } },
    });
  });

  it("lets an admin call an admin method", async () => {
    const { dispatch } = setup(admin);

    expect((await dispatch("fixture.admin", { count: "2" })).status).toBe(200);
  });

  it("checks the caller before the payload: an invalid payload from an anonymous caller gets 401", async () => {
    const { dispatch } = setup(anonymous);

    expect((await dispatch("fixture.session", { count: 1, extra: "x" })).status).toBe(401);
    expect((await dispatch("fixture.session", "not an object")).status).toBe(401);
  });

  it("answers 400 rpc.invalid_payload for a payload the contract rejects, without echoing it", async () => {
    const { dispatch } = setup(user);

    const response = await dispatch("fixture.session", { count: "not a number secret-value" });

    expect(response).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: ERROR_CODES.invalidPayload } },
    });
    expect(JSON.stringify(response)).not.toContain("secret-value");
  });

  it("answers a handler's RpcFailure with its status and error", async () => {
    const failing = defineHandler(publicEcho, () =>
      Promise.reject(new RpcFailure(409, "example.conflict", "Already exists")),
    );
    const { dispatch } = setup(anonymous, [failing]);

    expect(await dispatch("fixture.public", { count: "1" })).toEqual({
      status: 409,
      body: { ok: false, error: { code: "example.conflict", message: "Already exists" } },
    });
  });

  it("lets any other handler error through to the HTTP layer", async () => {
    const boom = new Error("database exploded");
    const failing = defineHandler(publicEcho, () => Promise.reject(boom));
    const { dispatch } = setup(anonymous, [failing]);

    await expect(dispatch("fixture.public", { count: "1" })).rejects.toBe(boom);
  });

  it("passes the caller and request to the handler", async () => {
    const handle = vi.fn(() => Promise.resolve({ doubled: 0 }));
    const { dispatch } = setup(user, [defineHandler(sessionEcho, handle)]);

    await dispatch("fixture.session", { count: "0" });

    expect(handle).toHaveBeenCalledWith(
      { count: 0 },
      expect.objectContaining({ actor: user, requestId: "r1" }),
    );
  });

  it("refuses two handlers for one method", () => {
    expect(() =>
      createRpcDispatcher({
        handlers: [double(publicEcho), double(publicEcho)],
        resolveActor: () => Promise.resolve(anonymous),
      }),
    ).toThrow("Duplicate RPC handler for fixture.public");
  });
});
