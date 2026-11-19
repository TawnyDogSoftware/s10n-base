import { Schema } from "effect";

import { defineRpc, Role } from "./rpc";

/** The most users one `admin.listUsers` page returns. */
export const ADMIN_USERS_PAGE_MAX = 100;

/** One user as the admin user list shows it. */
export const AdminUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Role,
  emailVerified: Schema.Boolean,
  banned: Schema.Boolean,
  /** ISO 8601. */
  createdAt: Schema.String,
});
export type AdminUser = typeof AdminUser.Type;

/**
 * A page of users, newest first. `nextCursor` is opaque: pass it back unchanged to get the next
 * page; it is `null` on the last page.
 */
export const AdminUserList = Schema.Struct({
  users: Schema.Array(AdminUser),
  nextCursor: Schema.NullOr(Schema.String),
});
export type AdminUserList = typeof AdminUserList.Type;

export const AdminListUsersPayload = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: ADMIN_USERS_PAGE_MAX })),
  /** The `nextCursor` of the previous page; absent or `null` for the first page. */
  cursor: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  ),
});
export type AdminListUsersPayload = typeof AdminListUsersPayload.Type;

/** `admin.listUsers`: every user, newest first, one page at a time. Admins only. */
export const adminListUsers = defineRpc({
  method: "admin.listUsers",
  auth: { role: "admin" },
  payload: AdminListUsersPayload,
  success: AdminUserList,
});
