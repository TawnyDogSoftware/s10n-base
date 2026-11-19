# Changelog

Scaffold-level changes to S10N Base, newest first. Projects created from an earlier version of the scaffold do not receive these changes automatically; use this file to decide what to port.

## Unreleased

### Added: auth (Better Auth, our own SES sender, a local inbox)

Users can sign up, verify their email, sign in, reset their password and add passkeys, over HTTP; there is no UI yet. Details and reasons are in `plans/004-auth.md`; how it works is in `docs/auth.md`.

- **Better Auth 1.7.25** with `@better-auth/expo` and `@better-auth/passkey` at the same exact version, and `better-call` 1.4.5 declared directly (a test checks it equals the version `better-auth` depends on). Email and password with verification required, the `expo` plugin, the `admin` plugin (roles `user` and `admin`, the stock `/admin/remove-user` off) and passkeys. Telemetry off.
- **Options** are built by one tested function (`apps/server/src/auth/options.ts`): `ba_*` tables with snake_case columns and UUID ids, both kinds of email link valid for one hour, sessions revoked on password reset, rate limits on in every environment and kept in the database, cookies prefixed `s10n-base.` and `Secure` under https, trusted origins `APP_URL`, the app variant's URL scheme and (development only) `exp://`. Better Auth's origin and CSRF checks are set on explicitly, since Better Auth turns them off when `NODE_ENV` is `test`.
- **Migration `001_auth`:** the six tables, with foreign keys that cascade from the user. A live test compares them with Better Auth's schema for our options, both ways.
- **`/api/auth/*`** goes through a route guard matched with Better Auth's own router, admitting only the routes `apps/server/src/auth/allowed-routes.ts` exposes (404 JSON otherwise, before the body is read), then a Node-to-Fetch bridge that builds the URL from `APP_URL`, applies the body limit, passes the resolved client address in an internal header and keeps every `Set-Cookie`. A test fails when Better Auth serves a route nobody decided about.
- **`GET /api/app-auth/session`** returns the app-owned `AppSession` (new in `packages/contracts`), or `null`.
- **RPC:** the caller comes from the session, looked up only for methods that need it; handlers call `context.getActor()` (this replaces `context.actor`). `/rpc` and `/api/app-auth/*` refuse a request whose `Origin` is not trusted (403).
- **Email:** our own Amazon SES v2 client (a SigV4 signer verified against the AWS test suite, one `fetch` per email, retries only when SES certainly did not accept it, typed errors without secrets) behind `AuthEmailSender`. No AWS SDK.
- **Local inbox:** `bun run ses:local`, our own capture server, which `bun dev` also starts. It checks each request's signature, keeps the last 200 emails, and serves an inbox at `http://127.0.0.1:8005/` and the emails as JSON at `/store`. It replaces the SES emulator package.
- **New variables:** `BETTER_AUTH_SECRET`, `APP_VARIANT`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `SES_REGION`, `SES_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. Production refuses the example secret, `SES_ENDPOINT` and the placeholder keys, and requires `APP_VARIANT`.
- **`bun run auth:set-role <email> <role>`** (and `dist/set-role.mjs`) makes the first admin.
- **`packages/shared/app-variants`:** the mobile app variants' URL schemes and display names, with placeholder values.
- **Formatter:** the generated database types and the SigV4 test-suite fixtures are excluded from oxfmt, so they stay exactly as generated or published.

### Added: hosted server core (Postgres, config, hardened HTTP, graceful shutdown, RPC auth levels)

The server can now run as a multi-instance hosted service, with no auth yet. Details and reasons are in `plans/003-hosted-server-core.md`; setup is in `docs/setup.md`.

- **Config:** one module built on Effect `Config` reads `NODE_ENV`, `APP_URL` (the single public origin; `https` in production), `HOST` (default `0.0.0.0`), `PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `TRUSTED_PROXY_HOPS`, `REQUEST_BODY_LIMIT_BYTES`, `SHUTDOWN_TIMEOUT_MS` and `LOG_LEVEL`. Startup fails with one log line listing every invalid or missing variable; a value of `DATABASE_URL` is never printed. `.env.example` lists them all.
- **Removed:** `S10N_BASE_PORT`; use `PORT`. The server's default bind address is now `0.0.0.0` (it was `127.0.0.1`).
- **Changed:** `GET /config` returns `APP_URL`'s origin as `apiBaseUrl`; it no longer reads the `Host` or `X-Forwarded-Proto` headers.
- **Postgres:** `pg` 8.23.1 and Kysely 0.29.9, a pool with timeouts and an error listener, and generated database types (`kysely-codegen` 0.20.0, `bun run db:generate`). Migrations are numbered TypeScript files in an explicit list (empty for now), run by a separate entry point (`apps/server/dist/migrate.mjs`, `bun run db:migrate`) under an advisory lock. The server never migrates on startup.
- **HTTP:** CORS allows only `APP_URL`'s origin; request bodies are limited (413) and `/rpc` requires JSON (415); every response has an `X-Request-Id` and security headers (a CSP on HTML, HSTS on https); a 500 never contains the error's message; unknown API paths answer 404 JSON and a wrong method 405; the client address honours `X-Forwarded-For` only behind `TRUSTED_PROXY_HOPS` proxies; static files are streamed with a containment check that no longer accepts a sibling directory with the same name prefix.
- **Health:** `GET /health` is liveness only. New `GET /ready` checks the database and answers 503 while shutting down.
- **Lifecycle:** config, logger, database and HTTP server are Effect layers. SIGTERM or SIGINT stops accepting connections, lets requests in flight finish for up to `SHUTDOWN_TIMEOUT_MS`, then closes the pool. Exit code 0 after a clean stop, 1 after a forced one or a failed startup.
- **Logging:** one JSON object per line on stdout at every level (`at`, `level`, `message`, fields), filtered by `LOG_LEVEL`, with one access-log line per request.
- **RPC:** `defineRpc` takes one object with a required `auth` (`"public"`, `"session"` or `{ role }`), and contracts carry separate encoded and decoded types. A dispatcher checks the method (404), the caller (401 or 403) before the payload (400), and encodes the result. Error codes are constants in `ERROR_CODES`. A test fails when a contract has no handler.
- **Removed from `packages/shared`:** `json.ts` (`decodeUnknown`, `encode`, `safeJsonParse`), which had no caller.
- **Local development:** `docker-compose.local.yml` runs Postgres 18.7 on `127.0.0.1:54320`. `bun dev` starts it, migrates, and runs the server and web app; the Vite dev server listens on `APP_URL`.
- **Tests:** a live-Postgres lane (`*.live.test.ts`, `bun run test:live`) with a throwaway schema per suite, a guard that `TEST_DATABASE_URL` names a `_test` database, and `bun run db:test:sweep`. CI runs it against a Postgres service, and the smoke test also checks `/ready`, the web app and a clean exit on SIGTERM.

### Changed: toolchain and packages, CI, and daily dependency updates

Every package and tool moved to the newest stable release that is at least 3 days old, and that rule is now enforced. Details and reasons are in `plans/002-toolchain-upgrade-and-ci.md`.

- **Versions:** Node 26.13.1 (was `>=24`), bun 1.4.4 (was 1.3.9), TypeScript ~6.0.3 (from ^5.9.3; held below 6.1 for typescript-eslint), turbo 2.11.11, effect 4.1.4 stable (from 4.0.0-beta.45), Vite 8.3.8 with `@vitejs/plugin-react` 6.3.0, Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0, tsdown 0.23.7, jsdom 31.0.1, `@testing-library/jest-dom` 7.0.1 (with `@testing-library/dom` 10.4.2 as its peer), Tailwind 4.3.5, TanStack Router 1.170.46 and Query 5.107.1, React 19.3.0 exactly (held for Expo SDK 58), oxlint 1.93.0 and oxfmt 0.78.0 exactly. The lockfile advisories in `ws`, vite, vitest, turbo and effect are gone, and `bun audit` reports nothing.
- **One place per version:** `.nvmrc` holds Node and `packageManager` holds bun; `engines` and `@types/node` follow, and a test fails if they disagree. Every catalog entry, including oxlint and oxfmt, is in the root catalog.
- **3-day rule:** `bunfig.toml` sets `minimumReleaseAge`. How to take a bug-fix release early is in `docs/dependencies.md`.
- **The built server starts:** `apps/server/tsdown.config.ts` bundles `@s10n-base/*` packages, which export TypeScript source (`deps.alwaysBundle`), and no longer emits declarations. Before this, `node apps/server/dist/bin.mjs` failed with `ERR_MODULE_NOT_FOUND`. `bun run smoke` starts the built server and checks `/health`.
- **Tests:** `vitest.workspace.ts` is replaced by a root `vitest.config.ts` with `test.projects`, and `bun run test` runs it. Vitest 5 clears mocks before each test and fails on un-awaited async assertions. `packages/shared` has tests and no longer passes with none. The web test setup stubs `window.scrollTo`.
- **CI:** `.github/workflows/ci.yml` runs a frozen install, format check, lint, typecheck, tests, build and the smoke test on every pull request and push to `main`. Dependabot updates GitHub Actions weekly with a 3-day cooldown.
- **Daily dependency updates:** `.github/workflows/dependency-updates.yml` opens one PR a day with every update the rule allows, including bun and Node, except packages held in `dependency-holds.json`. It needs a GitHub App and two secrets; see `docs/dependencies.md`. `bun run deps:update --dry-run` previews it.

### Removed: the desktop and local-first layer

The scaffold no longer assumes it runs as a local desktop app. Nothing replaces these yet; Postgres, auth and a new example domain come in later changes (see `plans/000-hosted-starter-rework.md`).

- **Desktop app:** `apps/desktop` (Electron), `scripts/wait-for-http.mjs`, the `dev:desktop` and `start:desktop` scripts, and every `dist-electron` entry in `.gitignore`, `.oxlintrc.json`, `turbo.json` and the `clean` script.
- **Local data:** the SQLite database (`better-sqlite3`), the `settings.json` file, the file logger, and the `S10N_BASE_HOME` runtime directory with its `data/` and `logs/` folders. The server no longer writes any file; logs are JSON lines on stdout.
- **WebSocket:** the activity hub, the `/ws` endpoint and its Vite proxy entry, and the `ws` dependency.
- **Demo domain:** the projects, notes, settings and activity contracts, services, RPC methods, web routes and stores, and `zustand`. `rpcContracts` is now an empty registry.
- **Contracts:** `DeleteResult`, `RPC_METHODS`, `EmptyPayload`, and the `websocketUrl` and `desktopHost` fields of `BootstrapConfig`. `defineRpc` is now exported, and a new `RpcRequest` schema describes the `{method, payload}` envelope.
- **Server:** the `bin` entry in `apps/server/package.json`. `POST /rpc` now answers 400 `rpc.invalid_request` for a body that is not a valid envelope (it was a 500 for invalid JSON), and 404 `rpc.method_not_found` for any method.
- **Environment variables:** `S10N_BASE_HOME`, `S10N_BASE_SERVER_URL` and `VITE_DEV_SERVER_URL`.
- **Build info:** the committed `tsconfig.tsbuildinfo` files; `*.tsbuildinfo` is now ignored.
- **Docs:** `EXTRACTION_REPORT.md`, and the desktop, settings, WebSocket, runtime-files and example-domain sections of the README and customization guide.
