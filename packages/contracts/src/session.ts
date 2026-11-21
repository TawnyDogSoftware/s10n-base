import { Schema } from "effect";

import { Role } from "./rpc";

/**
 * The signed-in user as the app sees it. This shape is ours: it stays the same when Better
 * Auth's own session and user objects change, and clients depend on it rather than on them.
 */
export const AppSession = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Role,
  emailVerified: Schema.Boolean,
  /**
   * When the session ends, as an ISO 8601 instant in UTC. The session route moves it when it
   * renews the session; clients read the session again at this time.
   */
  expiresAt: Schema.String,
});
export type AppSession = typeof AppSession.Type;

/** `data` of `GET /api/app-auth/session`: the session, or `null` when signed out. */
export const AppSessionResponse = Schema.Struct({
  session: Schema.NullOr(AppSession),
});
export type AppSessionResponse = typeof AppSessionResponse.Type;
