import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@s10n-base/contracts";

import type { DB } from "../infra/postgres/generated/db";
import { scriptedDb } from "../test/scripted-db";
import { type Actor, RpcFailure } from "./dispatcher";
import { createSessionTransaction, sessionGrants } from "./session-transaction";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const LATER = new Date("2026-11-27T12:00:00.000Z");
const EARLIER = new Date("2026-11-13T12:00:00.000Z");

const caller: Actor = { kind: "user", userId: "u1", role: "user", sessionId: "s1" };
const active = { expires_at: LATER, banned: false, ban_expires: null };

/**
 * A session transaction over a scripted database and a fake clock that both write to one log, so
 * a test sees the order of the lock, the clock and the read.
 */
function harness(row: Record<string, unknown> | undefined, actor: Actor = caller) {
  const log: string[] = [];
  const scripted = scriptedDb<DB>((query) => {
    if (query.sql.endsWith("for update")) {
      log.push("lock");
      return row === undefined ? [] : [{ id: "s1" }];
    }
    log.push("read");
    return row === undefined ? [] : [row];
  });
  const sessionTransaction = createSessionTransaction({
    transaction: (work) => scripted.db.transaction().execute(work),
    now: () => {
      log.push("clock");
      return NOW;
    },
  });
  const run = () =>
    sessionTransaction({ getActor: () => Promise.resolve(actor) }, (_trx, signedIn) => {
      log.push("work");
      return Promise.resolve(signedIn.userId);
    });
  return { log, run, queries: scripted.queries };
}

/** A session transaction on the default clock, for a session expiring `offset` ms from now. */
function withSystemClock(offset: number) {
  const expires_at = new Date(Date.now() + offset);
  const scripted = scriptedDb<DB>(() => [{ ...active, expires_at }]);
  return createSessionTransaction({
    transaction: (work) => scripted.db.transaction().execute(work),
  })({ getActor: () => Promise.resolve(caller) }, () => Promise.resolve("done"));
}

describe("sessionGrants", () => {
  it("grants an existing, unexpired session whose user is not banned", () => {
    expect(sessionGrants(active, NOW)).toBe(true);
    expect(sessionGrants({ ...active, banned: null }, NOW)).toBe(true);
    expect(sessionGrants({ ...active, banned: true, ban_expires: EARLIER }, NOW)).toBe(true);
  });

  it("still grants a session that expires at this very moment, as Better Auth does", () => {
    expect(sessionGrants({ ...active, expires_at: NOW }, NOW)).toBe(true);
  });

  it("refuses a missing session, an expired one, and a banned user's", () => {
    expect(sessionGrants(undefined, NOW)).toBe(false);
    expect(sessionGrants({ ...active, expires_at: EARLIER }, NOW)).toBe(false);
    expect(sessionGrants({ ...active, banned: true }, NOW)).toBe(false);
    expect(sessionGrants({ ...active, banned: true, ban_expires: LATER }, NOW)).toBe(false);
  });
});

describe("createSessionTransaction", () => {
  it("locks the caller's session, then reads the clock, then the session, then runs the work", async () => {
    const { log, run, queries } = harness(active);

    expect(await run()).toBe("u1");
    expect(log).toEqual(["lock", "clock", "read", "work"]);
    expect(queries[0]?.sql).toBe(
      'select "id" from "ba_session" where "id" = $1 and "user_id" = $2 for update',
    );
    expect(queries[0]?.parameters).toEqual(["s1", "u1"]);
    expect(queries[1]?.parameters).toEqual(["s1", "u1"]);
  });

  it.each([
    ["missing", undefined],
    ["expired", { ...active, expires_at: EARLIER }],
    ["banned", { ...active, banned: true }],
  ])("fails with auth.unauthenticated, before the work, when the session is %s", async (_, row) => {
    const { log, run } = harness(row);

    const failure = await run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RpcFailure);
    expect(failure).toMatchObject({ status: 401, code: ERROR_CODES.unauthenticated });
    expect(log).not.toContain("work");
  });

  it("reads the system clock by default", async () => {
    expect(await withSystemClock(60_000)).toBe("done");
    await expect(withSystemClock(-60_000)).rejects.toBeInstanceOf(RpcFailure);
  });

  it("refuses an anonymous caller without opening a transaction", async () => {
    const { run, queries } = harness(active, { kind: "anonymous" });

    await expect(run()).rejects.toThrow("A session method was called without a session.");
    expect(queries).toEqual([]);
  });
});
