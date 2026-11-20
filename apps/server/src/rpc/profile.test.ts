import { describe, expect, it, vi } from "vitest";

import { ERROR_CODES } from "@s10n-base/contracts";

import type { AppAuth } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { createLogger } from "../observability/logger";
import { scriptedDb } from "../test/scripted-db";
import type { Actor, RpcHandlerContext } from "./dispatcher";
import { profileHandlers } from "./profile";
import type { SessionTransaction } from "./session-transaction";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function contextFor(actor: Actor): RpcHandlerContext {
  return {
    requestId: "r1",
    logger: createLogger({ level: "error", write: () => {} }),
    getActor: () => Promise.resolve(actor),
  };
}

const signedIn = contextFor({ kind: "user", userId: USER_ID, role: "user", sessionId: "s1" });

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
  // Stands in for the recheck: it records that the work ran inside it, for the signed-in caller.
  const transactions: string[] = [];
  const sessionTransaction: SessionTransaction = async (context, work) => {
    const actor = await context.getActor();
    if (actor.kind !== "user") throw new Error("Expected a signed-in caller.");
    return scripted.db.transaction().execute(async (trx) => {
      transactions.push("begin");
      const result = await work(trx, actor);
      transactions.push("commit");
      return result;
    });
  };
  const [get, update] = profileHandlers({
    db: scripted.db,
    auth: { updateUserName },
    sessionTransaction,
  });
  if (get === undefined || update === undefined)
    throw new Error("The profile handlers are missing.");
  return { get, update, updateUserName, transactions, queries: scripted.queries };
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

  it("reads without a session transaction or a lock", async () => {
    const { get, transactions, queries } = handlers([row]);

    await get.handle({}, signedIn);

    expect(transactions).toEqual([]);
    expect(queries.map((query) => query.sql).join("\n")).not.toMatch(/for update/);
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
  it("renames the caller through Better Auth, in a session transaction, and returns the new profile", async () => {
    const { update, updateUserName, transactions } = handlers([]);
    updateUserName.mockImplementationOnce((id, name) => {
      expect(transactions).toEqual(["begin"]);
      return Promise.resolve({ ...row, id, name, emailVerified: true, createdAt: row.created_at });
    });

    expect(await update.handle({ userId: USER_ID, name: "Sam" }, signedIn)).toMatchObject({
      userId: USER_ID,
      name: "Sam",
    });
    expect(updateUserName).toHaveBeenCalledWith(USER_ID, "Sam");
    expect(transactions).toEqual(["begin", "commit"]);
  });

  it("refuses, without writing, a rename meant for another user than the caller", async () => {
    const { update, updateUserName } = handlers([]);

    await expect(
      update.handle({ userId: "00000000-0000-4000-8000-000000000002", name: "Sam" }, signedIn),
    ).rejects.toMatchObject({ status: 401, code: ERROR_CODES.unauthenticated });
    expect(updateUserName).not.toHaveBeenCalled();
  });
});
