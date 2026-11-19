import { describe, expect, it, vi } from "vitest";

import type { AppAuth } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { createLogger } from "../observability/logger";
import { scriptedDb } from "../test/scripted-db";
import type { Actor, RpcHandlerContext } from "./dispatcher";
import { profileHandlers } from "./profile";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function contextFor(actor: Actor): RpcHandlerContext {
  return {
    requestId: "r1",
    logger: createLogger({ level: "error", write: () => {} }),
    getActor: () => Promise.resolve(actor),
  };
}

const signedIn = contextFor({ kind: "user", userId: USER_ID, role: "user" });

const row = {
  id: USER_ID,
  name: "Robin",
  email: "robin@example.com",
  image: null,
  role: "user",
  email_verified: true,
  created_at: new Date("2026-11-19T10:00:00.000Z"),
};

function handlers(rows: ReadonlyArray<Record<string, unknown>>) {
  const scripted = scriptedDb<DB>(() => rows);
  const updateUserName = vi.fn<AppAuth["updateUserName"]>((id, name) =>
    Promise.resolve({ ...row, id, name, emailVerified: true, createdAt: row.created_at }),
  );
  const [get, update] = profileHandlers({ db: scripted.db, auth: { updateUserName } });
  if (get === undefined || update === undefined)
    throw new Error("The profile handlers are missing.");
  return { get, update, updateUserName, queries: scripted.queries };
}

describe("profile.get", () => {
  it("reads the caller's own row", async () => {
    const { get, queries } = handlers([row]);

    expect(await get.handle({}, signedIn)).toEqual({
      userId: USER_ID,
      name: "Robin",
      email: "robin@example.com",
      image: null,
      role: "user",
      emailVerified: true,
      createdAt: "2026-11-19T10:00:00.000Z",
    });
    expect(queries[0]?.parameters).toEqual([USER_ID]);
  });

  it("fails when the caller's row is gone", async () => {
    const { get } = handlers([]);

    await expect(get.handle({}, signedIn)).rejects.toThrow("no result");
  });

  it("refuses an anonymous caller, which the dispatcher should already have done", async () => {
    const { get, queries } = handlers([row]);

    await expect(get.handle({}, contextFor({ kind: "anonymous" }))).rejects.toThrow(
      "A session method was called without a session.",
    );
    expect(queries).toEqual([]);
  });
});

describe("profile.update", () => {
  it("renames the caller through Better Auth and returns the new profile", async () => {
    const { update, updateUserName } = handlers([]);

    expect(await update.handle({ name: "Sam" }, signedIn)).toMatchObject({
      userId: USER_ID,
      name: "Sam",
    });
    expect(updateUserName).toHaveBeenCalledWith(USER_ID, "Sam");
  });
});
