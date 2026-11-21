/**
 * A transaction on the authority of the caller's session.
 *
 * The dispatcher checks the session when a call starts. A session can be revoked after that (a
 * sign-out elsewhere, a password reset, an admin's ban), so a handler that writes on the session's
 * authority runs its writes through a session transaction, which checks again inside the same
 * transaction:
 *
 * ```ts
 * defineHandler(someWrite, (payload, context) =>
 *   sessionTransaction(context, async (trx, caller) => {
 *     // writes on trx, or through Better Auth, on behalf of caller.userId
 *   }),
 * );
 * ```
 *
 * It locks the caller's session row first, then reads the clock, then reads the session and its
 * user: the session must still exist, must not have expired, and its user must not be banned, as
 * in the session lookup. Otherwise the work never runs, nothing is written, and the call fails
 * with `auth.unauthenticated`, as an anonymous call does. While the lock is held, a revocation
 * waits for the transaction to finish. Better Auth's queries made inside the work join the
 * transaction (`infra/postgres/transactions.ts`). Read-only handlers do not need one.
 */
import type { Transaction } from "kysely";

import { ERROR_CODES } from "@s10n-base/contracts";

import { isBanned } from "../auth/instance";
import type { DB } from "../infra/postgres/generated/db";
import type { JoinableTransactions } from "../infra/postgres/transactions";
import { type Actor, RpcFailure, type RpcHandlerContext } from "./dispatcher";

/** A signed-in caller. */
export type SignedInActor = Extract<Actor, { readonly kind: "user" }>;

/** The caller, who must be signed in: the dispatcher has already refused anonymous callers. */
export function signedIn(actor: Actor): SignedInActor {
  if (actor.kind !== "user") throw new Error("A session method was called without a session.");
  return actor;
}

/** The session row and its user's ban, as read under the session row's lock. */
interface LockedSession {
  readonly expires_at: Date;
  readonly banned: boolean | null;
  readonly ban_expires: Date | null;
}

/**
 * Whether a session still grants its authority at `now`: it exists, has not expired, and its
 * user is not banned. Expired means `expires_at` is before `now`, as Better Auth judges it.
 */
export function sessionGrants(session: LockedSession | undefined, now: Date): boolean {
  if (session === undefined) return false;
  if (session.expires_at.getTime() < now.getTime()) return false;
  return !isBanned({ banned: session.banned, banExpires: session.ban_expires }, now);
}

async function recheckSession(
  trx: Transaction<DB>,
  caller: SignedInActor,
  now: () => Date,
): Promise<void> {
  await trx
    .selectFrom("ba_session")
    .select("id")
    .where("id", "=", caller.sessionId)
    .where("user_id", "=", caller.userId)
    .forUpdate()
    .execute();
  // Only now, with the lock held: a clock read before waiting for it would judge a moment that
  // has already passed.
  const at = now();
  // A statement of its own, so it sees what committed while this one waited for the lock.
  const session = await trx
    .selectFrom("ba_session")
    .innerJoin("ba_user", "ba_user.id", "ba_session.user_id")
    .select(["ba_session.expires_at", "ba_user.banned", "ba_user.ban_expires"])
    .where("ba_session.id", "=", caller.sessionId)
    .where("ba_session.user_id", "=", caller.userId)
    .executeTakeFirst();
  if (!sessionGrants(session, at)) {
    throw new RpcFailure(401, ERROR_CODES.unauthenticated, "Sign in to use this method.");
  }
}

/** Runs `work` in a transaction after rechecking, inside it, the caller's session. */
export type SessionTransaction = <T>(
  context: Pick<RpcHandlerContext, "getActor">,
  work: (trx: Transaction<DB>, caller: SignedInActor) => Promise<T>,
) => Promise<T>;

export interface SessionTransactionDependencies {
  readonly transaction: JoinableTransactions<DB>["transaction"];
  /** The clock read under the lock. Defaults to the system clock. */
  readonly now?: (() => Date) | undefined;
}

export function createSessionTransaction(
  dependencies: SessionTransactionDependencies,
): SessionTransaction {
  const { transaction, now = () => new Date() } = dependencies;
  return async (context, work) => {
    const caller = signedIn(await context.getActor());
    return transaction(async (trx) => {
      await recheckSession(trx, caller, now);
      return work(trx, caller);
    });
  };
}
