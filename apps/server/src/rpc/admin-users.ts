import { type Kysely, sql } from "kysely";

import { adminListUsers, ERROR_CODES } from "@s10n-base/contracts";

import { appRoleOf } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { defineHandler, RpcFailure, type RpcHandler } from "./dispatcher";
import { decodeUserCursor, encodeUserCursor } from "./user-cursor";

/**
 * `admin.listUsers`: users newest first, with keyset pagination on `(created_at, id)`. The id
 * breaks ties, so users created at the same instant are neither repeated nor skipped.
 */
export function adminUserHandlers(dependencies: { readonly db: Kysely<DB> }): RpcHandler[] {
  const { db } = dependencies;
  return [
    defineHandler(adminListUsers, async ({ limit, cursor }) => {
      const after = cursor === undefined || cursor === null ? null : decodeUserCursor(cursor);
      if (after === null && typeof cursor === "string") {
        throw new RpcFailure(400, ERROR_CODES.invalidCursor, "The cursor is not valid.");
      }
      let query = db
        .selectFrom("ba_user")
        .select([
          "id",
          "name",
          "email",
          "role",
          "email_verified",
          "banned",
          "created_at",
          sql<string>`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            "cursor_at",
          ),
        ])
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(limit + 1);
      if (after !== null) {
        query = query.where(
          sql<boolean>`(created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
        );
      }
      const rows = await query.execute();
      const page = rows.slice(0, limit);
      // The extra row only says there is another page; the cursor is the page's last row.
      const last = rows.length > limit ? page.at(-1) : undefined;
      return {
        users: page.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: appRoleOf(row.role),
          emailVerified: row.email_verified,
          banned: row.banned === true,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        nextCursor:
          last === undefined ? null : encodeUserCursor({ createdAt: last.cursor_at, id: last.id }),
      };
    }),
  ];
}
