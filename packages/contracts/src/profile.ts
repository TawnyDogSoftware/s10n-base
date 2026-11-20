import { Schema } from "effect";

import { defineRpc, Role } from "./rpc";

/** The longest display name, in characters, after trimming. */
export const PROFILE_NAME_MAX = 100;

/**
 * A display name as the user typed it: surrounding whitespace is trimmed, then it must have 1 to
 * {@link PROFILE_NAME_MAX} characters. Clients validate with it before sending, and the server
 * decodes with it, so both apply the same rule.
 */
export const ProfileName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(PROFILE_NAME_MAX),
);
export type ProfileName = typeof ProfileName.Type;

/** The signed-in user's own account, as the profile page shows it. */
export const Profile = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  role: Role,
  emailVerified: Schema.Boolean,
  /** When the account was created, as an ISO 8601 string. */
  createdAt: Schema.String,
});
export type Profile = typeof Profile.Type;

/** `profile.get`: the caller's profile. */
export const profileGet = defineRpc({
  method: "profile.get",
  auth: "session",
  payload: Schema.Struct({}),
  success: Profile,
});

/**
 * `profile.update`: changes the caller's display name and returns the updated profile. `userId`
 * is the user the screen was showing when the name was typed; the server refuses the call with
 * `auth.unauthenticated` when the session belongs to anyone else (another tab signed in as
 * someone else meanwhile), so a name typed for one user is never saved for another.
 */
export const profileUpdate = defineRpc({
  method: "profile.update",
  auth: "session",
  payload: Schema.Struct({ userId: Schema.String, name: ProfileName }),
  success: Profile,
});
