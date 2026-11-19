# 003: Hosted server core

> Status: not started.

Phase 3 of [000](000-hosted-starter-rework.md). Builds on [001](001-strip-desktop-and-local-first.md) and [002](002-toolchain-upgrade-and-ci.md). Source labels are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

Turn the stripped server into one that can be deployed as a multi-instance hosted service, with no auth yet: validated config, Postgres with migrations, a hardened HTTP layer, an ordered lifecycle, structured logs, an RPC dispatcher that enforces an auth level per method, a live-database test lane, and one command for local development.

Decision D1 of plan 000 applies and is fixed: Effect `Schema` for contracts, and Effect's stable core on the server for `Config` (env validation), `Layer`/`Scope` (startup and shutdown order) and `Schedule` (retries and timeouts). HTTP and RPC stay on `node:http`. No `@effect/*` package is added; everything comes from `effect`.

**D1 has no pattern in our projects to copy.** All three validate config and order shutdown by hand. The reference for how layers are written is T3 Code upstream (public, `pingdotgg/t3code`, on Effect 4.1.x); read how it builds and runs its server layers before writing ours, and check every Effect API you use against the installed 4.1.4 types rather than memory, because the 4.x API differs from 3.x and from the betas.

## 2. Out of scope

| Not in this phase | Owner |
|---|---|
| Better Auth, sessions, cookies, `/api/auth`, email, rate limiting | Phase 4 |
| Any real RPC method or table; the web client's base URL and session state | Phases 4 and 5 |
| ESLint, knip, the coverage threshold, Playwright | Phase 7 |
| Dockerfile for the app, deployment docs | Phase 8 |
| README rewrite, `AGENTS.md`, rename script | Phase 9 |

## 3. Dependencies added

Each through the age gate, versions recorded in section 11.

- `pg`: the Postgres driver all three projects use.
- `kysely`, inside `0.29.x` (the hold list already has the entry): query builder and migrator.
- `kysely-codegen` (dev): generates the database types from the migrated schema.
- `@types/pg` (dev).

Nothing else. If something seems to need another package, stop and say why.

## 4. Config

`apps/server/src/config/`. One module built on Effect `Config`, loaded once at startup.

| Variable | Rule | Default |
|---|---|---|
| `NODE_ENV` | `development`, `test` or `production` | `development` |
| `APP_URL` | The single public origin users see. A bare origin (scheme, host, optional port; no path, query or credentials). `https` required in production. | none: required |
| `HOST` | Bind address | `0.0.0.0` |
| `PORT` | Integer 0 to 65535 | `4210` |
| `DATABASE_URL` | `postgres://` or `postgresql://` URL. Treated as a secret. | none: required |
| `DATABASE_POOL_MAX` | Integer 1 to 100 | `10` |
| `TRUSTED_PROXY_HOPS` | Integer 0 to 10: how many reverse proxies sit in front | `0` |
| `REQUEST_BODY_LIMIT_BYTES` | Integer, at least 1024 | `1048576` |
| `SHUTDOWN_TIMEOUT_MS` | Integer 1000 to 60000 | `10000` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |

- **Every problem is reported at once**: one error listing each invalid or missing variable by name with the rule it broke. It never prints a value of `DATABASE_URL`. Find out how Effect 4.1.4 accumulates config errors and use that; if it cannot, say so and collect them in our own code, still exposing an Effect `Config`-based API.
- `S10N_BASE_PORT` is removed. In development `APP_URL` is the web dev server's origin (the browser talks to Vite, which proxies to the API).
- `GET /config` returns `apiBaseUrl` from `APP_URL`. It no longer reads `Host` or `X-Forwarded-Proto`.
- `.env.example` at the repo root lists every variable with a development value that works with the compose file in section 9. `.env` is ignored by git.
- `turbo.json` `globalEnv` lists the same names.
- Tests: each rule, the defaults, several errors reported together, the production-only rules, and that the secret is not in the error text.

## 5. Database

`apps/server/src/infra/postgres/`.

- **Pool:** `pg.Pool` from `DATABASE_URL` with `max`, a connect timeout, a statement timeout and an idle timeout. An `error` listener on the pool logs dropped idle connections; without one, a database restart crashes the process. An optional `searchPath` option (validated as a single lowercase identifier) for the live tests.
- **Kysely:** `Kysely<DB>` over that pool, with `DB` imported from `generated/db.ts`.
- **Migrations:** numbered, append-only TypeScript files in `migrations/`, listed in `migrations/index.ts` (an explicit map, so the bundle contains them; no directory scanning at run time). **The committed list is empty in this phase**: phase 4 adds the first migration. The migrator is tested with fixture migrations.
- **Migrator:** Kysely's `Migrator`, run on one pinned connection that holds a Postgres session advisory lock for the whole run, so two instances started together cannot migrate at once. A failed migration surfaces the cause and exits non-zero.
- **`migrate` entry point:** `apps/server/src/migrate.ts`, a second tsdown entry (`dist/migrate.mjs`). Commands: `up` (default), `status` (applied, pending, and applied-but-unknown names; read-only), and `down` and `reset`, which refuse to run when `NODE_ENV=production`. It retries the first connection on an Effect `Schedule` (bounded, so starting next to a database that is still booting works) and uses a pool of one. **The API never migrates on startup.**
- **Types:** `bun run db:generate` runs `kysely-codegen` against a migrated database and writes `generated/db.ts`. `bun run db:generate:check` fails if the committed file differs from what the schema produces; CI runs it. With no migrations the generated interface is empty, which is correct for now.
- Root scripts: `db:up`, `db:down` (compose), `db:migrate`, `db:status`, `db:reset`, `db:generate`, `db:generate:check`.

## 6. HTTP layer

`apps/server/src/http/`, one small module per concern, each with its own tests. `routes.ts` becomes a thin router.

- **Request id:** each request gets an id (`crypto.randomUUID()`), returned as `X-Request-Id` and attached to every log line for that request. An incoming `X-Request-Id` is not trusted.
- **CORS:** only `APP_URL`'s origin is allowed. For that origin: `Access-Control-Allow-Origin` echoing it, `Access-Control-Allow-Credentials: true`, `Vary: Origin`, and a correct preflight. For any other origin: no CORS headers, and a preflight gets 403. Requests with no `Origin` header (same-origin, mobile, curl) are not blocked by CORS.
- **Body:** a reader that enforces `REQUEST_BODY_LIMIT_BYTES` while reading (413, and the socket is not left hanging), requires `application/json` on `/rpc` (415), and maps invalid JSON to 400.
- **Client IP:** from the socket when `TRUSTED_PROXY_HOPS` is 0; otherwise the entry that many hops from the right of `X-Forwarded-For`. Never the leftmost entry. Malformed headers fall back to the socket address.
- **Security headers** on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, a `Content-Security-Policy` on HTML that the built web app satisfies (check the built `index.html`: Vite's output has no inline script), and `Strict-Transport-Security` when `APP_URL` is `https`.
- **Errors:** an unexpected error is logged with the request id and its stack, and answered with 500 and a fixed message. No internal message reaches the client. Unknown API paths answer 404 JSON; a wrong method on a known path answers 405.
- **Static files:** serves `apps/web/dist` from the same origin. Async and streamed, not `readFileSync`. Containment is checked with a path-separator-aware comparison after resolving (the old `startsWith` check accepted a sibling directory with the same prefix). Long-lived immutable caching for hashed assets, `no-cache` for `index.html`. The SPA fallback applies only to `GET` requests that accept HTML and are not under `/rpc`, `/api`, `/health`, `/ready` or `/config`. When no web build exists, non-API paths are 404.
- **Health:** `GET /health` is liveness: it answers 200 whenever the process is serving and touches nothing else. `GET /ready` is readiness: it runs `select 1` with a short timeout and answers 200 or 503. While shutting down, `/ready` answers 503.

## 7. Lifecycle and logging

- **Layers:** config, logger, database, HTTP server, composed so that acquisition runs in that order and release runs in reverse. Releasing the HTTP server means: stop accepting connections, mark not-ready, let in-flight requests finish, close idle keep-alive connections, and after `SHUTDOWN_TIMEOUT_MS` force-close what is left. Only then is the pool closed. This fixes defect 4 of plan 000.
- **Process:** `bin.ts` registers `SIGTERM` and `SIGINT` before starting, starts the layers, and on a signal closes the scope. A second signal during shutdown does not start a second shutdown. A clean stop exits 0; a forced one exits 1; a startup failure prints the config or connection error as one log line and exits 1. Nothing is swallowed by a floating promise.
- **`startServer`** remains for tests: it takes a config (not `process.env`) and returns `{port, stop}`.
- **Logger:** one JSON object per line on stdout, nothing else, at every level: `at`, `level`, `message`, and fields. Levels filtered by `LOG_LEVEL`. One access-log line per request (method, path without query string, status, duration, request id, client IP). Errors are serialised with name, message and stack. No `console.*` anywhere else in the server.
- Tests, written first: release order (a request still in flight when the signal arrives completes, and the pool is closed after it, proven with a fake pool that records the order); the deadline forces a stuck request and reports a forced stop; double signal; startup failure exit code; `/ready` flips to 503 during shutdown.

## 8. RPC

- **Contracts** (`packages/contracts`):
  - `Role`: `user` or `admin` (the roles phase 4's admin plugin will use).
  - `RpcAuth`: `"public"`, `"session"`, or `{ role: Role }`.
  - `RpcContract` gains a required `auth`; `defineRpc` takes one object and there is no default level.
  - Error codes as constants: `auth.unauthenticated`, `auth.forbidden`, `rpc.invalid_request`, `rpc.invalid_payload`, `rpc.method_not_found`, `server.unexpected_error`.
  - Type the payload and success schemas so encoded and decoded types can differ, and remove the `as never` casts here and in `packages/shared/src/json.ts`. If a helper in `shared/json.ts` has no caller left, delete it.
- **Dispatcher** (`apps/server/src/rpc/dispatcher.ts`): built from a list of handlers, each `{contract, handle(payload, context)}`. For each call, in this order: unknown method is 404; the auth level is checked against the caller (401 or 403) **before the payload is decoded**, so a caller who may not use a method learns nothing about its payload; the payload is decoded with the contract (400 `rpc.invalid_payload`); the handler runs; the result is encoded with the contract. A handler can fail with a typed failure carrying a status and error code; anything else is a 500 through the HTTP error path. Duplicate handlers for one method throw at construction.
- **Caller:** the dispatcher gets an `Actor` (`anonymous`, or `{userId, role}`) from a resolver passed in at construction. In this phase the resolver always returns `anonymous`; phase 4 replaces it with the session lookup. The response envelope stays `{ok: true, data}` or `{ok: false, error}`.
- **Registry:** `rpcContracts` and the server's handler list are both empty in this phase. An exhaustiveness test fails when a contract has no handler or a handler has no contract; prove the test can fail by running the same check against fixture lists that are deliberately mismatched.
- Tests use fixture contracts at each auth level: anonymous against `session` and role methods; `user` against an `admin` method; an invalid payload sent by an unauthorised caller gets 401, not 400.

## 9. Local development and the live test lane

- `docker-compose.local.yml`: Postgres 18 (newest 18.x image at least 3 days old, pinned by tag), published on `127.0.0.1` only, a health check over TCP, a named volume, and an init script that creates a second database whose name ends in `_test`.
- `bun dev` (`scripts/dev.ts`): starts the database and waits for it to be healthy, runs `db:migrate`, then starts the server and the web dev server, and stops both children when interrupted. It loads `.env` if present and otherwise uses the `.env.example` values. `dev:server` and `dev:web` remain. The server's `dev` script uses bun's watch mode.
- **Live tests:** files named `*.live.test.ts`, run by `bun run test:live` (`apps/server/vitest.live.config.ts`, not a member of the root projects). `bun run test` must pass with no database running.
  - `TEST_DATABASE_URL` is required and never falls back to `DATABASE_URL`. Before any DDL the fixture checks that the URL's database name ends in `_test` **and** that `select current_database()` on the open connection says the same.
  - Each suite gets a throwaway schema with a random name, used through `searchPath`, and drops it afterwards.
  - `bun run db:test:sweep` removes fixture schemas left behind by killed runs.
  - Live suites in this phase: the pool (search path, idle-error listener does not crash, statement timeout), the migrator (fixture migrations up, status, down; two concurrent runs serialise on the lock; a failing migration reports its cause), `/ready` against a real database, and codegen output against a fixture schema.
- **CI:** add a Postgres service container on the same image tag as the compose file (a test compares the two), create the `_test` database, then run `db:migrate`, `db:generate:check`, `test:live`. The smoke step now also sets the required variables, checks `/ready`, and checks that `SIGTERM` leads to exit code 0 within the deadline.
- `.github/dependabot.yml`: add the `docker-compose` ecosystem with the same cooldown, ignoring Postgres major versions.

## 10. Docs, verification, definition of done

Docs:

- `docs/setup.md`: prerequisites, `bun dev`, the env variables table, the database commands, how to add a migration, how to run the live tests.
- `README.md`: point to `docs/setup.md`; fix the commands and environment sections. No rewrite.
- `CHANGELOG.md`: an entry, including the removed `S10N_BASE_PORT` and the changed `/config` behaviour.
- `plans/000-hosted-starter-rework.md`: status line; mark defects 3 (the parts not about auth), 4 and 5 fixed; correct anything this phase disproved.

On the final commit, recorded in section 11 and the PR description:

1. From clean: frozen install, `fmt:check`, `lint`, `typecheck`, `test` (with the database stopped), `build`, `smoke`.
2. With the compose database up: `db:migrate`, `db:status`, `db:generate:check`, `test:live`, `db:test:sweep`.
3. `bun dev` from a state with no `.env` and no running containers: the app answers on the web dev origin, `/health` and `/ready` are 200 through the Vite proxy. Stop the database container: `/ready` becomes 503 while `/health` stays 200, and the server does not crash. Start it again: `/ready` recovers.
4. With the built server: a request from a foreign `Origin` gets no CORS headers; a body over the limit gets 413; a thrown error gets the fixed 500 body; a path-traversal request for a sibling of the web build directory is refused; `SIGTERM` during a slow request lets it finish and the process exits 0.
5. Starting with several bad variables prints one error naming each, exits 1, and the output does not contain the database password.
6. CI green on the head commit, including the Postgres steps.
7. The scrub check from plan 000 prints nothing.

Done when sections 4 to 10 are in, the above passes, nothing in section 2 was touched, and section 11 records the dependency versions, how Effect `Config`, `Layer`, `Scope` and `Schedule` were actually used (with any API that did not behave as expected), and every departure from this plan with the reason.

## 11. How it was built

Filled in by the implementor.
