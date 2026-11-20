import { type Kysely, sql } from "kysely";

import { adminListUsers, ERROR_CODES } from "@s10n-base/contracts";

import { appRoleOf, isBanned } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { defineHandler, RpcFailure, type RpcHandler } from "./dispatcher";
import { decodeUserCursor, encodeUserCursor } from "./user-cursor";

/**
 * `admin.listUsers`: users newest first, with keyset pagination on `(created_at, id)`. The id
 * breaks ties, so users created at the same instant are neither repeated nor skipped. A user is
 * shown as banned only while the ban is in force, judged as the session lookup judges it: Better
 * Auth clears an ended ban only at the user's next sign-in.
 */
export function adminUserHandlers(dependencies: {
  readonly db: Kysely<DB>;
  readonly now?: (() => Date) | undefined;
}): RpcHandler[] {
  const { db, now = () => new Date() } = dependencies;
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
          "ban_expires",
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
      const at = now();
      // The extra row only says there is another page; the cursor is the page's last row.
      const last = rows.length > limit ? page.at(-1) : undefined;
      return {
        users: page.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: appRoleOf(row.role),
          emailVerified: row.email_verified,
          banned: isBanned({ banned: row.banned, banExpires: row.ban_expires }, at),
          createdAt: new Date(row.created_at).toISOString(),
        })),
        nextCursor:
          last === undefined ? null : encodeUserCursor({ createdAt: last.cursor_at, id: last.id }),
      };
    }),
  ];
}
