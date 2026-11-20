/**
 * Decides which requests under `/api/auth` reach Better Auth, before the body is read and before
 * Better Auth sees the request. Matching uses the `better-call` router, the router Better Auth
 * itself uses, configured the same way, so the guard and Better Auth cannot disagree about which
 * endpoint a path means (path parameters, trailing slashes, repeated slashes). A request that
 * does not match an exposed endpoint never reaches Better Auth, so it cannot run its middleware
 * or create a rate-limit row.
 */
import { createEndpoint, createRouter, type Endpoint } from "better-call";

/** One route: an HTTP method and a path under the auth base path, such as `/sign-in/email`. */
export interface AuthRoute {
  readonly method: string;
  readonly path: string;
}

/** The parts of a Better Auth endpoint the guard reads: its path, methods and metadata. */
export interface InventoryEndpoint {
  readonly path?: string | undefined;
  readonly options?:
    | {
        readonly method?: string | readonly string[] | undefined;
        readonly metadata?: { readonly SERVER_ONLY?: boolean | undefined } | undefined;
      }
    | undefined;
}

function servedPath(endpoint: InventoryEndpoint, disabledPaths: readonly string[]): string | null {
  const { path, options } = endpoint;
  if (path === undefined || path === "" || options?.metadata?.SERVER_ONLY === true) return null;
  return disabledPaths.includes(path) ? null : path;
}

/**
 * Every route Better Auth serves over HTTP for these endpoints (`auth.api`): each method of each
 * endpoint with a path, leaving out server-only endpoints and `disabledPaths`. Sorted by path
 * then method.
 */
export function authRouteInventory(
  endpoints: Readonly<Record<string, InventoryEndpoint>>,
  disabledPaths: readonly string[],
): AuthRoute[] {
  const routes: AuthRoute[] = [];
  for (const endpoint of Object.values(endpoints)) {
    const path = servedPath(endpoint, disabledPaths);
    if (path === null) continue;
    const methods = [endpoint.options?.method ?? []].flat();
    for (const method of methods) routes.push({ method, path });
  }
  return routes.toSorted((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

export function routeKey(route: AuthRoute): string {
  return `${route.method} ${route.path}`;
}

/** Whether a request may go on to Better Auth. */
export type AuthRouteGuard = (method: string, url: URL) => Promise<boolean>;

/**
 * Builds the guard: it admits a request only when the router matches it to one of `routes`.
 * Nothing of the request is read but its method and URL.
 */
export function createAuthRouteGuard(
  routes: readonly AuthRoute[],
  options: { readonly basePath: string; readonly skipTrailingSlashes: boolean },
): AuthRouteGuard {
  const byPath = new Map<string, string[]>();
  for (const route of routes)
    byPath.set(route.path, [...(byPath.get(route.path) ?? []), route.method]);
  const endpoints: Record<string, Endpoint> = {};
  let index = 0;
  for (const [path, methods] of byPath) {
    endpoints[`route${String(index++)}`] = createEndpoint(
      path,
      { method: methods as ["GET"], disableBody: true },
      () => Promise.resolve(new Response(null, { status: 204 })),
    );
  }
  // The settings Better Auth's own router uses.
  const router = createRouter(endpoints, {
    basePath: options.basePath,
    openapi: { disabled: true },
    skipTrailingSlashes: options.skipTrailingSlashes,
  });
  return async (method, url) => {
    let request: Request;
    try {
      request = new Request(url, { method });
    } catch {
      // A method Fetch refuses (CONNECT, TRACE, or not a token) is never an auth route.
      return false;
    }
    return (await router.handler(request)).status === 204;
  };
}
