/**
 * The server's Better Auth instance, behind the small interface the rest of the server uses.
 * Routes, the RPC caller and tests depend on {@link AppAuth}, never on Better Auth's own types.
 */
import { betterAuth } from "better-auth";

import type { AppSession, Role } from "@s10n-base/contracts";

import { EXPOSED_AUTH_ROUTES } from "./allowed-routes";
import type { AuthOptions } from "./options";
import {
  authRouteInventory,
  createAuthRouteGuard,
  routeKey,
  type AuthRoute,
  type AuthRouteGuard,
  type InventoryEndpoint,
} from "./route-guard";

export interface AppAuth {
  /** Serves a request under `/api/auth`. Only call it for requests the guard admitted. */
  readonly handler: (request: Request) => Promise<Response>;
  /** Admits a request only when it is for an exposed Better Auth route. */
  readonly guard: AuthRouteGuard;
  /** Every route Better Auth serves over HTTP, exposed or not. */
  readonly routes: readonly AuthRoute[];
  /**
   * The signed-in user for a request's cookies, with the id of their session row, or `null` when
   * there is no valid session, the session expired, or the user is banned.
   */
  readonly getSession: (headers: Headers) => Promise<SignedInSession | null>;
  /**
   * The same, plus the cookies Better Auth set while reading it: a renewed session cookie once
   * the session is a day old (`session.updateAge`), or a deletion for one that is gone. The
   * app's session route passes them on, so an active user's cookie keeps being renewed; without
   * them it would expire seven days after sign-in however active the user is.
   */
  readonly readSession: (headers: Headers) => Promise<{
    readonly session: AppSession | null;
    readonly setCookies: readonly string[];
  }>;
  /** Whether an `Origin` header value is one Better Auth trusts, matched the way it matches. */
  readonly isTrustedOrigin: (origin: string) => Promise<boolean>;
  /**
   * Changes a user's display name through Better Auth's own adapter, so its user hooks run and
   * any session storage it keeps is refreshed, and returns the updated user.
   */
  readonly updateUserName: (
    userId: string,
    name: string,
  ) => Promise<AuthUser & { createdAt: Date }>;
}

/** A signed-in caller: their session as clients see it, and the id of the session row behind it. */
export interface SignedInSession {
  readonly session: AppSession;
  readonly sessionId: string;
}

/** The user fields {@link toAppSession} reads, as Better Auth and its admin plugin return them. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image?: string | null | undefined;
  readonly emailVerified: boolean;
  readonly role?: unknown;
  readonly banned?: boolean | null | undefined;
  readonly banExpires?: Date | string | null | undefined;
}

/**
 * The app's role for a Better Auth role value. The admin plugin stores several roles as a
 * comma-separated string; any that is `admin` makes the user an admin.
 */
export function appRoleOf(role: unknown): Role {
  if (typeof role !== "string") return "user";
  return role.split(",").some((part) => part.trim() === "admin") ? "admin" : "user";
}

/** Whether a ban is in force at `now`: banned, and either without an end or not yet ended. */
export function isBanned(user: Pick<AuthUser, "banned" | "banExpires">, now: Date): boolean {
  if (user.banned !== true) return false;
  if (user.banExpires === null || user.banExpires === undefined) return true;
  return new Date(user.banExpires).getTime() > now.getTime();
}

/** What the mapping reads of Better Auth's session row: when it ends. */
interface AuthSessionExpiry {
  readonly expiresAt: Date | string;
}

/** Better Auth's lookup result, as far as the mapping reads it. */
interface LookupResult {
  readonly user: unknown;
  readonly session: AuthSessionExpiry;
}

/**
 * Maps Better Auth's user, and the moment its session ends, to the stable {@link AppSession}
 * shape.
 */
export function toAppSession(user: AuthUser, expiresAt: Date | string): AppSession {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    role: appRoleOf(user.role),
    emailVerified: user.emailVerified,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** The session of Better Auth's lookup result: none when there is none, or the user is banned. */
export function sessionOf(result: LookupResult | null, now: Date): AppSession | null {
  if (result === null) return null;
  const user = result.user as AuthUser;
  return isBanned(user, now) ? null : toAppSession(user, result.session.expiresAt);
}

/** The signed-in caller of Better Auth's lookup result: none when there is none, or banned. */
export function signedInOf(
  result: {
    readonly user: unknown;
    readonly session: AuthSessionExpiry & { readonly id: string };
  } | null,
  now: Date,
): SignedInSession | null {
  const session = sessionOf(result, now);
  return result === null || session === null ? null : { session, sessionId: result.session.id };
}

/**
 * The session route's answer for Better Auth's lookup result and the cookies it set. A banned
 * user's session is not renewed for them, so their cookies are dropped.
 */
export function readSessionOf(
  result: LookupResult | null,
  setCookies: string[],
  now: Date,
): { readonly session: AppSession | null; readonly setCookies: string[] } {
  const session = sessionOf(result, now);
  if (result !== null && session === null) return { session: null, setCookies: [] };
  return { session, setCookies };
}

/** Creates the Better Auth instance. Nothing touches the database until a request. */
export function createAppAuth(options: AuthOptions, now: () => Date = () => new Date()): AppAuth {
  const auth = betterAuth(options);
  const routes = authRouteInventory(
    auth.api as unknown as Record<string, InventoryEndpoint>,
    options.disabledPaths,
  );
  const exposed = new Set(EXPOSED_AUTH_ROUTES.map(routeKey));
  const guard = createAuthRouteGuard(
    routes.filter((route) => exposed.has(routeKey(route))),
    {
      basePath: options.basePath,
      skipTrailingSlashes: options.advanced.skipTrailingSlashes ?? false,
    },
  );
  return {
    handler: (request) => auth.handler(request),
    guard,
    routes,
    // Read-only: the caller of an RPC gets no cookie back, so renewing here would extend the
    // session in the database while the client keeps the old cookie. The session route renews.
    getSession: async (headers) =>
      signedInOf(await auth.api.getSession({ headers, query: { disableRefresh: true } }), now()),
    readSession: async (headers) => {
      const result = await auth.api.getSession({ headers, returnHeaders: true });
      return readSessionOf(result.response, result.headers.getSetCookie(), now());
    },
    isTrustedOrigin: async (origin) => (await auth.$context).isTrustedOrigin(origin),
    updateUserName: async (userId, name) =>
      (await auth.$context).internalAdapter.updateUser(userId, { name }),
  };
}
