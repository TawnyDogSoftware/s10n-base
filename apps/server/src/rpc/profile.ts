import type { Kysely } from "kysely";

import { type Profile, profileGet, profileUpdate } from "@s10n-base/contracts";

import { appRoleOf, type AppAuth } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { type Actor, defineHandler, type RpcHandler } from "./dispatcher";

/** The user fields a profile is built from, as the database or Better Auth return them. */
export interface ProfileSource {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null | undefined;
  readonly role?: unknown;
  readonly emailVerified: boolean;
  readonly createdAt: Date | string;
}

export function profileFromUser(user: ProfileSource): Profile {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: appRoleOf(user.role),
    emailVerified: user.emailVerified,
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

/** The signed-in caller's id. The dispatcher has already refused anonymous callers. */
function userIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("A session method was called without a session.");
  return actor.userId;
}

export interface ProfileHandlerDependencies {
  readonly db: Kysely<DB>;
  readonly auth: Pick<AppAuth, "updateUserName">;
}

export function profileHandlers(dependencies: ProfileHandlerDependencies): RpcHandler[] {
  const { db, auth } = dependencies;
  return [
    defineHandler(profileGet, async (_payload, context) => {
      const userId = userIdOf(await context.getActor());
      const row = await db
        .selectFrom("ba_user")
        .select(["id", "name", "email", "image", "role", "email_verified", "created_at"])
        .where("id", "=", userId)
        .executeTakeFirstOrThrow();
      return profileFromUser({
        ...row,
        emailVerified: row.email_verified,
        createdAt: row.created_at,
      });
    }),
    // Through Better Auth rather than a direct UPDATE, so its user hooks run and any session
    // storage it keeps is refreshed: the session route shows the new name at once.
    defineHandler(profileUpdate, async ({ name }, context) => {
      const userId = userIdOf(await context.getActor());
      return profileFromUser(await auth.updateUserName(userId, name));
    }),
  ];
}
