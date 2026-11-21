# 001: Effect's stable core runs the server's lifecycle; HTTP stays on node:http

- **Status:** Accepted, 2026-11-18.

## Context

The server has to start in a known order (config, logger, database, HTTP), stop in the reverse order with requests drained before the database pool closes, validate its whole configuration before it does anything, and retry a few operations with bounds. Each project built on this base got those wrong at first and fixed them by hand, each in its own way. The scaffold already used Effect, but only its `Schema` module, for contracts.

Effect's core has a tool for each of these needs. Its platform and HTTP packages would also replace the server's request handling, which is small, already tested, and well understood.

## Decision

- **Contracts:** Effect `Schema`, as before.
- **Server lifecycle:** Effect's stable core from the `effect` package only. `Layer` and `Scope` acquire config, logger, database and HTTP server in order and release them in reverse; `Config` reads and validates the environment; `Schedule` bounds retries and timeouts.
- **Requests:** HTTP and RPC stay on plain `node:http` and promises. No `@effect/*` package.

## Consequences

- Shutdown order is structural rather than a convention: the HTTP server is released (drained, then force-closed at the deadline) before the pool.
- Effect 4.1's `Config` stops at the first invalid variable, so the config module parses each variable on its own and reports every problem together (plan 003, section 11).
- Without `@effect/platform-node` there is no `runMain`, so signal handling is a small hand-written module.
- The base is the first of our codebases to use Effect beyond `Schema`, so it is the place this pattern is proven or dropped. Contributors need to read a little Effect to change startup or shutdown; request handlers need none.
- One `effect` version is forced across the tree by a root override, so its schemas and errors are the same classes everywhere.

## Revisit when

- The lifecycle code becomes harder to change than the hand-written version it replaced, or the backports to existing projects (plan 000, phase 10) show it does not carry over.
- Request handling needs what an Effect HTTP stack gives for free (typed middleware, OpenAPI from schemas) badly enough to justify moving all routes.
- Effect's core changes its API in a way that makes the upgrade cost more than the lifecycle code itself.
