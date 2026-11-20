import type { Kysely } from "kysely";

import { type Profile, profileGet, profileUpdate } from "@s10n-base/contracts";

import { appRoleOf, type AppAuth } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import { defineHandler, type RpcHandler } from "./dispatcher";
import { type SessionTransaction, signedIn } from "./session-transaction";

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

export interface ProfileHandlerDependencies {
  readonly db: Kysely<DB>;
  readonly auth: Pick<AppAuth, "updateUserName">;
  readonly sessionTransaction: SessionTransaction;
}

export function profileHandlers(dependencies: ProfileHandlerDependencies): RpcHandler[] {
  const { db, auth, sessionTransaction } = dependencies;
  return [
    defineHandler(profileGet, async (_payload, context) => {
      const { userId } = signedIn(await context.getActor());
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
    // storage it keeps is refreshed: the session route shows the new name at once. In a session
    // transaction, which Better Auth's write joins, so a session revoked during the call cannot
    // still change the name.
    defineHandler(profileUpdate, ({ name }, context) =>
      sessionTransaction(context, async (_trx, caller) =>
        profileFromUser(await auth.updateUserName(caller.userId, name)),
      ),
    ),
  ];
}
