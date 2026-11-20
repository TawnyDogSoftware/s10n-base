/**
 * The session recheck in `profile.update`, against Postgres, with each race made deterministic:
 * a second connection holds a row lock so the request stops at a known point, and the test waits
 * until Postgres reports the request blocked on that connection, never for a fixed time.
 */
import { type ControlledTransaction, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ERROR_CODES } from "@s10n-base/contracts";

import type { DB } from "../infra/postgres/generated/db";
import { startAuthServer, TestClient, verifyPath, type AuthServer } from "../test/auth-server";

const PASSWORD = "correct horse battery staple";
const UNAUTHENTICATED = {
  status: 401,
  body: { ok: false, error: { code: ERROR_CODES.unauthenticated } },
};
const WEEK_AND_A_DAY = 8 * 24 * 60 * 60 * 1000;
let app: AuthServer;
let nextIp = 1;
/** How far the session transaction's clock is ahead of the system clock. */
let skew = 0;

async function signedInUser() {
  const browser = new TestClient(app.base, `198.51.100.${String(nextIp)}`);
  const email = `recheck-${String(nextIp++)}@example.com`;
  expect(
    (await browser.post("/api/auth/sign-up/email", { name: "Before", email, password: PASSWORD }))
      .status,
  ).toBe(200);
  const [message] = (await app.emailsTo(email)).slice(-1);
  expect((await browser.get(verifyPath(message))).status).toBe(200);
  expect(
    (await browser.post("/api/auth/sign-in/email", { email, password: PASSWORD })).status,
  ).toBe(200);
  const { userId } = (await browser.session()) as { userId: string };
  userIds.set(browser, userId);
  return { browser, userId };
}

/** Each client's user, read once at sign-in: a read during a race would take part in it. */
const userIds = new WeakMap<TestClient, string>();

async function rename(browser: TestClient, name: string) {
  const response = await browser.post("/rpc", {
    method: "profile.update",
    payload: { userId: userIds.get(browser), name },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function nameOf(userId: string): Promise<string> {
  const row = await app.schema.db
    .selectFrom("ba_user")
    .select("name")
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  return row.name;
}

/** Opens a transaction on its own connection and returns it with that connection's process id. */
async function otherConnection() {
  const trx = await app.schema.db.startTransaction().execute();
  const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
  return { trx, pid: rows[0]?.pid ?? -1 };
}

async function release(trx: ControlledTransaction<DB>) {
  if (!trx.isCommitted && !trx.isRolledBack) await trx.rollback().execute();
}

/** Locks every session row of a user from `trx`, as a revocation would before deleting them. */
async function lockSessions(trx: ControlledTransaction<DB>, userId: string) {
  await trx
    .selectFrom("ba_session")
    .select("id")
    .where("user_id", "=", userId)
    .forUpdate()
    .execute();
}

/** Whether the backend `pid` is waiting for a lock another backend holds. */
async function isWaiting(pid: number): Promise<boolean> {
  const { rows } = await sql<{ waiting: boolean }>`
    select cardinality(pg_blocking_pids(${pid})) > 0 as waiting
  `.execute(app.schema.db);
  return rows[0]?.waiting === true;
}

/** How many backends are waiting for a lock that the backend `pid` holds. */
async function waitingOn(pid: number): Promise<number> {
  const { rows } = await sql<{ waiting: string }>`
    select count(*) as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
  `.execute(app.schema.db);
  return Number(rows[0]?.waiting);
}

/**
 * Resolves once a backend is waiting on `pid`'s locks, or once `pending` has settled (so a
 * request that never waits fails its own assertions rather than a timeout here).
 */
async function untilBlockedOrSettled(pid: number, pending: Promise<unknown>) {
  let settled = false;
  void pending.finally(() => {
    settled = true;
  });
  await vi.waitFor(
    async () => {
      if (!settled && (await waitingOn(pid)) === 0) throw new Error("Nothing is waiting yet.");
    },
    { timeout: 10_000, interval: 10 },
  );
}

beforeAll(async () => {
  app = await startAuthServer({ now: () => new Date(Date.now() + skew) });
});

afterAll(async () => {
  await app.stop();
});

describe("profile.update rechecks its session inside its transaction", () => {
  it("refuses, and writes nothing, when the session is revoked after the dispatcher's check", async () => {
    const { browser, userId } = await signedInUser();
    const blocker = await otherConnection();
    try {
      await lockSessions(blocker.trx, userId);

      const pending = rename(browser, "After");
      await untilBlockedOrSettled(blocker.pid, pending);
      await blocker.trx.deleteFrom("ba_session").where("user_id", "=", userId).execute();
      await blocker.trx.commit().execute();

      const result = await pending;
      expect(await nameOf(userId)).toBe("Before");
      expect(result).toMatchObject(UNAUTHENTICATED);
    } finally {
      await release(blocker.trx);
    }
  });
  it("keeps the new name when the revocation commits after the update, and the next call is refused", async () => {
    const { browser, userId } = await signedInUser();
    // Holds the user row, so the update stops at its write with the session row already locked.
    const userBlocker = await otherConnection();
    const revoker = await otherConnection();
    try {
      await userBlocker.trx
        .selectFrom("ba_user")
        .select("id")
        .where("id", "=", userId)
        .forUpdate()
        .execute();
      const pending = rename(browser, "After");
      await untilBlockedOrSettled(userBlocker.pid, pending);

      const revoked = revoker.trx.deleteFrom("ba_session").where("user_id", "=", userId).execute();
      await vi.waitFor(
        async () => {
          if (!(await isWaiting(revoker.pid)))
            throw new Error("The revocation is not waiting yet.");
        },
        { timeout: 10_000, interval: 10 },
      );
      await userBlocker.trx.rollback().execute();

      expect(await pending).toMatchObject({
        status: 200,
        body: { ok: true, data: { name: "After" } },
      });
      expect((await revoked)[0]?.numDeletedRows).toBe(1n);
      await revoker.trx.commit().execute();
      expect(await nameOf(userId)).toBe("After");
      expect(await rename(browser, "Again")).toMatchObject(UNAUTHENTICATED);
      expect(await nameOf(userId)).toBe("After");
    } finally {
      await release(userBlocker.trx);
      await release(revoker.trx);
    }
  });

  it("refuses a session that expires while the update waits for its lock", async () => {
    const { browser, userId } = await signedInUser();
    const blocker = await otherConnection();
    try {
      await lockSessions(blocker.trx, userId);
      const pending = rename(browser, "After");
      await untilBlockedOrSettled(blocker.pid, pending);
      // Sessions last seven days: by this clock, the session has expired while the call waited.
      skew = WEEK_AND_A_DAY;
      await blocker.trx.rollback().execute();

      const result = await pending;
      expect(await nameOf(userId)).toBe("Before");
      expect(result).toMatchObject(UNAUTHENTICATED);
    } finally {
      skew = 0;
      await release(blocker.trx);
    }
  });

  it("refuses a user banned while the update waits for its lock", async () => {
    const { browser, userId } = await signedInUser();
    const blocker = await otherConnection();
    try {
      await lockSessions(blocker.trx, userId);
      const pending = rename(browser, "After");
      await untilBlockedOrSettled(blocker.pid, pending);
      // A ban that leaves the sessions in place: the recheck must still see it.
      await blocker.trx
        .updateTable("ba_user")
        .set({ banned: true })
        .where("id", "=", userId)
        .execute();
      await blocker.trx.commit().execute();

      const result = await pending;
      expect(await nameOf(userId)).toBe("Before");
      expect(result).toMatchObject(UNAUTHENTICATED);
    } finally {
      await release(blocker.trx);
    }
  });
});
