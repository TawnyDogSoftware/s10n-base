# 002: Better Auth is mounted behind a bridge and a route allow-list

- **Status:** Accepted, 2026-11-18.

## Context

The base needs sign-up, sign-in, sessions, password reset, roles and passkeys, for a browser and a native app. Better Auth provides them, and all three projects built on this base use it. It serves a large and growing set of HTTP endpoints, many of which a given product does not want exposed, and its handler speaks the Fetch API while the server is plain `node:http` ([001](001-effect-core-on-the-server.md)). Its own objects change shape between releases, which clients should not have to follow.

## Decision

- Better Auth is mounted at `/api/auth` through a small Node-to-Fetch bridge that builds the request URL from `APP_URL` (never the `Host` header), applies the server's body limit, passes the resolved client address, and keeps every `Set-Cookie` header.
- A route guard runs before the bridge. It is built from Better Auth's own endpoint inventory and matches paths with `better-call`, the router Better Auth itself uses, so the guard and Better Auth cannot disagree about what a path means. It admits only the routes a committed allow-list exposes; everything else is a 404 that never reaches Better Auth.
- Every endpoint Better Auth serves must be on the allow-list as exposed or deliberately not exposed, with a reason; a test fails on one that is on neither.
- The app owns its own routes under `/api/app-auth/*`, starting with the session route, which returns a stable `AppSession` shape from `packages/contracts`.

## Consequences

- An upgrade that adds an endpoint fails a test until someone decides about it, so nothing is exposed by accident.
- A request for an unknown path cannot run Better Auth's middleware or create a rate-limit row.
- Clients depend on `AppSession`, not on Better Auth's session object.
- `better-call` is a direct dependency pinned to exactly the version `better-auth` depends on, and `better-auth`, `@better-auth/expo`, `@better-auth/passkey` and `better-call` move together; a test checks it. The daily update holds them as a group.
- The bridge and guard are ours to maintain, about a few hundred lines with tests.

## Revisit when

- Better Auth exports its router or an official Node adapter that keeps multiple cookies and the body limit, making the bridge or the separate `better-call` pin unnecessary.
- Better Auth changes how it exposes its endpoint inventory, so the guard can no longer be built from it.
