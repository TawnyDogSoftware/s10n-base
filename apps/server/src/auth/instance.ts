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
   * The signed-in user for a request's cookies, or `null` when there is no valid session, the
   * session expired, or the user is banned.
   */
  readonly getSession: (headers: Headers) => Promise<AppSession | null>;
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

/** Maps Better Auth's user to the stable {@link AppSession} shape. */
export function toAppSession(user: AuthUser): AppSession {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    role: appRoleOf(user.role),
    emailVerified: user.emailVerified,
  };
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
    getSession: async (headers) => {
      const result = await auth.api.getSession({ headers });
      if (result === null) return null;
      const user = result.user as AuthUser;
      return isBanned(user, now()) ? null : toAppSession(user);
    },
    isTrustedOrigin: async (origin) => (await auth.$context).isTrustedOrigin(origin),
    updateUserName: async (userId, name) =>
      (await auth.$context).internalAdapter.updateUser(userId, { name }),
  };
}
