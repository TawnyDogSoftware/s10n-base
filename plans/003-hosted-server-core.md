# 003: Hosted server core

> Status: implemented on 2026-11-19, on branch `feature/001-strip-desktop-and-local-first` (PR #1, which carries the whole rework).

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

Implemented on 2026-11-19 on Node 26.13.1 and bun 1.4.4, with Docker 29 for the local Postgres. Registry and image data were read the same day.

### Dependency versions

| Package | Version | Published | Where |
| --- | --- | --- | --- |
| `pg` | `^8.23.1`, 8.23.1 | 2026-09-30 | server dependency |
| `kysely` | `^0.29.9`, 0.29.9 | 2026-11-12 | server dependency; inside the `0.29.x` hold |
| `kysely-codegen` | `^0.20.0`, 0.20.0 | 2026-02-16 | server dev dependency |
| `@types/pg` | `^8.23.1`, 8.23.1 | 2026-08-17 | server dev dependency |
| Postgres image | `postgres:18.7` | release 2026-11-12 | compose file and CI service |

Each is the newest stable release at least 3 days old. The lockfile gained 49 packages (277 to 326 entries), most of them `kysely-codegen`'s CLI dependencies (`chalk`, `cosmiconfig`, `diff`, `dotenv`, `micromatch`, `zod` and theirs), all dev-only. `bun audit`: no vulnerabilities (288 packages). Nothing else was added.

On the image: PostgreSQL 18.7 was released on 2026-11-12 and the official image's `18.7` tag appeared that day. The tag was rebuilt on 2026-11-18 for a `gosu` update, so the image behind it is a day old even though the release is a week old. It is pinned by tag, as section 9 asks; Dependabot (`docker-compose` ecosystem, 3-day cooldown, majors ignored) proposes the next one.

### How Effect was used

All from `effect` 4.1.4; no `@effect/*` package.

- **`Config`:** each variable is its own `Config` (`Config.schema` with a `Schema` and `isBetween`/`makeFilter` checks, `Config.Literals`, `Config.withDefault`, `Config.map` for the origin and `Redacted`). `loadServerConfig` and `loadDatabaseConfig` read the current `ConfigProvider` (a `Context.Reference`; the environment by default) and `bin.ts` builds its config layer from it with `Layer.effect(AppConfig, loadServerConfig)`. Tests use `ConfigProvider.fromEnvRecord` and `fromUnknown`.
  - **Did not behave as hoped:** `Config.all` and `Config.schema` stop at the first failure. `Config.schema` runs its parser with the default parse options, and there is no annotation or provider option for `errors: "all"`. So the module parses every variable on its own (`Effect.result` around each `config.parse(provider)`) and collects the failures into one `ServerConfigError`, as section 4 allowed. Cross-variable rules (https in production) are checked whenever the variables they read are valid, so they are reported with the rest.
  - Effect's own `SchemaError` messages can quote the rejected value, so problems are reported with fixed rule text per variable, and missing versus invalid is told apart by reading the raw string with `Config.option(Config.String(name))`. A test checks no output contains a password.
  - `ConfigProvider.fromEnvRecord` treats an empty value as unset by default, which is what `.env` files need.
- **`Layer` and `Scope`:** four `Context.Service`s (`AppConfig`, `AppLogger`, `Database`, `HttpServer`), each with a `Layer.effect`, composed with `Layer.provideMerge` so acquisition runs config, logger, database, HTTP server, and release runs in reverse. The pool and the listening server are `Effect.acquireRelease` resources. `startServer` builds the layers with `Layer.buildWithScope` into a `Scope.make()` scope and stops by `Scope.close`; a failed build closes the scope, so a pool created before the database check failed is still ended (tested). A static `of` on a service class collides with `Context.Service`'s own `of`, so the helper is named `layer`.
- **`Schedule`:** the first database connection, in the `migrate` entry point and at server startup, retries with `Effect.retry({ schedule: Schedule.spaced("500 millis").pipe(Schedule.upTo({ duration: "30 seconds" })), while: isTransient })`. Network errors and SQLSTATEs `57P03` and `53300` are retried; a wrong password or a missing database fails at once.
- **Timeouts:** `Effect.timeoutOption` bounds the HTTP drain and the pool close by `SHUTDOWN_TIMEOUT_MS`; `Effect.timeout` bounds `/ready`'s `select 1` to two seconds.
- **Where D1 did not reach:** signal handling. Without `@effect/platform-node` there is no `runMain`, so `process.ts` registers SIGTERM and SIGINT by hand and closes the scope; it is unit-tested with a fake process. Request handling is plain `node:http` and promises, as D1 says; only startup and shutdown run as Effects.

### Claims checked by running them

- **Kysely's migrator** (0.29.9): its Postgres adapter does take a session advisory lock, but only after it has created its bookkeeping tables, and without `migrationTableSchema` it looks for its table in every schema (`#doesTableExist` matches any schema). So the migrator always passes the schema and wraps every write in our own advisory lock on a pinned connection. The live test shows two concurrent runs serialising and each migration applied once.
- **All pending migrations run in one transaction** on Postgres: when the second of two fails, neither is applied. The live test and `docs/setup.md` say so.
- **`kysely-codegen` 0.20.0** has `--verify`, skips Kysely's own tables, and with no tables writes `export interface DB {}`, which oxfmt and oxlint accept. The live test generates types for a fixture table and shows `--verify` failing after the table changes.
- **An idle connection killed by Postgres** (`pg_terminate_backend`, and a stopped container) is reported by the pool's `error` listener and the next query reconnects; without the listener Node would crash.
- **Vite's build has no inline script** (`apps/web/dist/index.html` loads one module script and one stylesheet from `/assets`), so the CSP is `script-src 'self'` with no `unsafe-inline`.
- **bun:** `bun --watch` does not exit when the event loop empties, so after a clean shutdown the server under `bun dev` stayed alive until the dev script killed it. The process now exits explicitly once shutdown completes. `bun run <script>` in 1.4.4 does not pass `.env` to the script it starts, while `bun file.ts` loads `.env` into its own process; the `db:*` scripts therefore go through `scripts/with-env.ts`.
- **Node's HTTP server** closes the connection after a 413 sent with `Connection: close` while the body is still arriving (tested with a raw socket claiming 10 MB).

### Departures from this plan, with reasons

- **Two more error codes:** `http.not_found` and `http.method_not_allowed`, for unknown API paths (404) and a wrong method (405). Section 8's six codes are RPC and auth codes; these two are not.
- **A role level requires exactly that role.** Section 8 does not say whether `admin` satisfies `{ role: "user" }`; it does not. A method for any signed-in user uses `"session"`.
- **The server checks the database at startup** (with the same retry as `migrate`) and fails startup, in one log line, if it cannot connect. Section 7 implies it ("the config or connection error"); this makes it explicit.
- **`reset` drops and recreates the schema** and then migrates, rather than reverting migration by migration, so it works when the history is broken.
- **Postgres is published on `127.0.0.1:54320`,** not 5432, so it does not clash with another local Postgres. CI maps the same port, so `.env.example`'s URLs work in both.
- **`scripts/with-env.ts`** loads `.env` (or `.env.example`) for `dev:server`, `dev:web`, `start:server`, the `db:*` scripts, `test:live` and `smoke`, not only for `bun dev`, so a fresh clone needs no `.env` for any of them.
- **The Vite dev server listens on `APP_URL`'s host and port** (it used `HOST`, the server's bind address, which now defaults to `0.0.0.0`) and proxies `/ready` and `/api` too. This is the only web change besides removing the `as never` casts in `apps/web/src/rpc/client.ts`.
- **The pool close has its own bound** of `SHUTDOWN_TIMEOUT_MS` after the HTTP drain, and a pool that does not close in time makes the stop forced (exit 1). `process.ts` exits 1 if the whole shutdown exceeds twice the deadline plus five seconds.
- **`packages/shared/src/json.ts` is deleted** with its tests, its export and `shared`'s `effect` dependency: none of its three helpers had a caller once the casts went.
- **The smoke test also checks that `/` serves the web app** when `apps/web/dist` exists. Manual verification found that the bundled server looked for the web build one directory too high (the config had moved into `src/config/`); the path now lives in `src/paths.ts`, and the smoke test would have caught it.
- **`ServerConfig.paths` became `webDistDir`,** and `startServer` returns `{port, config, stop}`, where `stop` resolves to `{ forced }`.
- **Process-level log lines** (startup failure, shutdown) are written at `info` regardless of `LOG_LEVEL`, since a startup failure may be the config itself.

### Verification on the final commit (section 10)

1. After `bun run clean`, with the database container stopped: `bun install --frozen-lockfile` passes (lockfile unchanged); `fmt:check`, `lint` (0 findings), `typecheck` (4 packages and `scripts`), `test` (36 files, 372 tests) and `build` pass. With the database started, `smoke` passes: `/health`, `/ready`, the web app at `/`, and exit 0 on SIGTERM.
2. With the compose database up: `db:migrate` (`applied: []`), `db:status` (`applied: [], pending: [], unknown: []`), `db:generate:check` ("Generated types are up-to-date"), `test:live` (6 files, 13 tests) and `db:test:sweep` (dropped a planted `fixture_1_aaaaaaaaaaaa`) pass.
3. `bun dev` with no `.env`, no running container and the data volume deleted: it printed "using .env.example", created the volume and both databases, migrated, and `http://localhost:5173/health`, `/ready` and `/config` answered 200 through the Vite proxy within 7 seconds. With the container stopped, `/ready` answered 503 `database_unavailable` while `/health` stayed 200, and the server logged `database_idle_connection_failed` and kept running. With it started again, `/ready` was 200 within 2 seconds. Ctrl-C (SIGINT to the process group) stopped the server, Vite and the dev script in under a second.
4. Against the built server (`node apps/server/dist/bin.mjs`): a POST from `Origin: https://evil.example.com` got no `Access-Control-*` headers and its preflight 403, while `APP_URL`'s origin got them; a 5 KB body with a 2 KB limit got 413; a static file the server could not open (mode 000) got the fixed 500 body with the error and request id logged; `/%2e%2e%2fdist-evil%2fsecret.txt`, `/../dist-evil/secret.txt` and `/..%2fdist-evil%2fsecret.txt` with a planted `apps/web/dist-evil/secret.txt` got 404 and no secret; a POST whose body was trickled at 1 KB/s was answered after SIGTERM (3 s) and the process exited 0. No RPC method exists in this phase, so "a thrown error" was produced through the static file path; the RPC path is covered by `routes.test.ts`.
5. `NODE_ENV=production APP_URL=http://example.com/app PORT=70000 LOG_LEVEL=verbose DATABASE_POOL_MAX=0 DATABASE_URL=mysql://app:<password>@db/app node apps/server/dist/bin.mjs` printed one JSON line, `Invalid configuration (5 problems)` naming each variable, exited 1, and the output did not contain the password. `bin.test.ts` checks the same from source.
6. CI on the head commit: see the PR description.
7. The scrub check prints nothing.

### For later phases

- **Phase 4:** the session lookup plugs in as `resolveActor` (`createRpcDispatcher({ handlers, resolveActor })`, also a `startServer` option). It is called for every known method, public ones included; make it cheap or lazy. `Database` exposes `db: Kysely<DB>` for the Better Auth Kysely adapter. The auth migration is the first entry in `migrations/index.ts`; run `db:generate` after it. `/api/*` answers 404 JSON today, and CORS allows only `GET, POST` and `content-type`; the auth routes will need more. `readBody` enforces the body limit and can back the Node-to-Fetch bridge. Live suites get a schema per suite from `createFixtureSchema()`.
- **Phase 5:** `/config` returns `APP_URL`'s origin; the Vite dev server listens on it and proxies `/api`.
- **Phase 7:** the live lane is not in the root projects, so coverage from it is separate. `paths.ts` must stay directly in `src/`.
- **Phase 8:** the bundle is `dist/bin.mjs`, `dist/migrate.mjs` and a shared chunk; `pg`, `kysely` and `effect` stay external, so the image needs production `node_modules`. The server finds the web build at `../../web/dist` from `apps/server/dist`, so the image must keep that layout (or the path must become configurable). `HOST` defaults to `0.0.0.0`; health checks are `/health` and `/ready`; SIGTERM exits 0 after a clean stop.
