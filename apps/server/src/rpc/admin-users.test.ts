import { describe, expect, it } from "vitest";

import { type AdminUserList, ERROR_CODES } from "@s10n-base/contracts";

import type { DB } from "../infra/postgres/generated/db";
import { createLogger } from "../observability/logger";
import { scriptedDb } from "../test/scripted-db";
import { adminUserHandlers } from "./admin-users";
import { RpcFailure, type RpcHandlerContext } from "./dispatcher";
import { encodeUserCursor } from "./user-cursor";

const context: RpcHandlerContext = {
  requestId: "r1",
  logger: createLogger({ level: "error", write: () => {} }),
  getActor: () => Promise.resolve({ kind: "user", userId: "admin", role: "admin" }),
};

function userRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${String(index)}`,
    name: `User ${String(index)}`,
    email: `user${String(index)}@example.com`,
    role: "user",
    email_verified: true,
    banned: false,
    created_at: new Date(`2026-11-1${String(index)}T10:00:00.000Z`),
    cursor_at: `2026-11-1${String(index)}T10:00:00.123456Z`,
    ...overrides,
  };
}

function listUsers(rows: ReadonlyArray<Record<string, unknown>>) {
  const scripted = scriptedDb<DB>(() => rows);
  const [handler] = adminUserHandlers({ db: scripted.db });
  if (handler === undefined) throw new Error("admin.listUsers has no handler.");
  return {
    queries: scripted.queries,
    call: (payload: { limit: number; cursor?: string | null }) =>
      handler.handle(payload, context) as Promise<AdminUserList>,
  };
}

describe("admin.listUsers", () => {
  it("asks for one row more than the page, and gives the last row's cursor when it came", async () => {
    const { call, queries } = listUsers([userRow(3), userRow(2), userRow(1)]);

    const result = await call({ limit: 2 });

    expect(result.users.map((user) => user.name)).toEqual(["User 3", "User 2"]);
    expect(result.nextCursor).toBe(
      encodeUserCursor({ createdAt: "2026-11-12T10:00:00.123456Z", id: userRow(2).id }),
    );
    expect(queries[0]?.parameters.at(-1)).toBe(3);
  });

  it("has no next cursor on the last page", async () => {
    const { call } = listUsers([userRow(2), userRow(1)]);

    expect((await call({ limit: 2, cursor: null })).nextCursor).toBeNull();
  });

  it("continues after the cursor's time and id", async () => {
    const after = { createdAt: "2026-11-12T10:00:00.123456Z", id: userRow(2).id };
    const { call, queries } = listUsers([userRow(1)]);

    await call({ limit: 2, cursor: encodeUserCursor(after) });

    expect(queries[0]?.parameters).toEqual([after.createdAt, after.id, 3]);
    expect(queries[0]?.sql).toContain("(created_at, id) <");
  });

  it("refuses a cursor it did not issue, without a query", async () => {
    const { call, queries } = listUsers([]);

    const failure = await call({ limit: 2, cursor: "not-a-cursor" }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RpcFailure);
    expect(failure).toMatchObject({ status: 400, code: ERROR_CODES.invalidCursor });
    expect(queries).toEqual([]);
  });

  it("maps each row to the contract: role, ban and creation time", async () => {
    const { call } = listUsers([
      userRow(1, { role: "user,admin", banned: null, email_verified: false }),
    ]);

    expect((await call({ limit: 10 })).users).toEqual([
      {
        id: userRow(1).id,
        name: "User 1",
        email: "user1@example.com",
        role: "admin",
        emailVerified: false,
        banned: false,
        createdAt: "2026-11-11T10:00:00.000Z",
      },
    ]);
  });
});
