# Changelog

Scaffold-level changes to S10N Base, newest first.

**How a project uses this file.** A project made from the base is a copy, not a fork: nothing here reaches it by merging ([decision 009](docs/adr/009-a-template-not-an-upstream.md)). Note the base commit your project started from; the entries after it are what the base has changed since. Read them, decide what is worth having, and port it by hand, following the plan or doc each entry points to. Entries say what changed and why, and call out what a project on the earlier scaffold has to change.

Versions and dates are set by the owner when a release is tagged. Until then everything is under "Unreleased".

## Unreleased: the hosted starter rework

The scaffold was a local desktop app in disguise: an Electron host, SQLite, settings and logs in the home directory, no auth and wildcard CORS. Every project built on it spent its first days undoing that and adding the same things. This release does that work once, in the base. It is now a hosted, multi-user starter: a Node server on Postgres with Better Auth, a React web app and an Expo mobile app on shared packages, with quality gates, CI, a container image, written conventions and a rename script. The plan and its ten decisions are in [plans/000-hosted-starter-rework.md](plans/000-hosted-starter-rework.md) and [docs/adr/](docs/adr/README.md); each area below names the plan with the details.

### For a project on the earlier scaffold

What changed under existing names, so a port does not miss it:

- **Removed environment variables:** `S10N_BASE_HOME`, `S10N_BASE_SERVER_URL`, `VITE_DEV_SERVER_URL` and `S10N_BASE_PORT` (use `PORT`). The server now requires `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, the email addresses and the SES settings, and binds to `0.0.0.0` by default (it was `127.0.0.1`).
- **`GET /config`** returns `APP_URL`'s origin as `apiBaseUrl` and no longer reads the `Host` or `X-Forwarded-Proto` headers; `websocketUrl` and `desktopHost` are gone from `BootstrapConfig`.
- **`POST /rpc`** answers 400 `rpc.invalid_request` for a body that is not a `{method, payload}` envelope (invalid JSON was a 500), requires `application/json` (415), and checks each method's auth level (401 or 403) before decoding its payload (400 `rpc.invalid_payload`). `defineRpc` takes one object with a required `auth`, and handlers read the caller with `await context.getActor()`.
- **The web client** takes an explicit base URL; relative URLs, `apps/web/src/lib/http.ts` and `apps/web/src/rpc/` are gone.
- **Removed:** the desktop app, SQLite, the WebSocket hub and `/ws`, the file logger, `settings.json`, the demo domain, `zustand`, `packages/shared/src/json.ts`, `CUSTOMIZATION_GUIDE.md` and `EXTRACTION_REPORT.md`.

### Removed: the desktop and local-first layer

[plans/001-strip-desktop-and-local-first.md](plans/001-strip-desktop-and-local-first.md)

- **Desktop app:** `apps/desktop` (Electron), `scripts/wait-for-http.mjs`, the `dev:desktop` and `start:desktop` scripts, and every `dist-electron` entry in `.gitignore`, `.oxlintrc.json`, `turbo.json` and the `clean` script.
- **Local data:** the SQLite database (`better-sqlite3`), the `settings.json` file, the file logger, and the `S10N_BASE_HOME` runtime directory with its `data/` and `logs/` folders. The server writes no file; logs are JSON lines on stdout.
- **WebSocket:** the activity hub, the `/ws` endpoint and its Vite proxy entry, and the `ws` dependency.
- **Demo domain:** the projects, notes, settings and activity contracts, services, RPC methods, web routes and stores, and `zustand`.
- **Contracts:** `DeleteResult`, `RPC_METHODS`, `EmptyPayload`, and `BootstrapConfig`'s `websocketUrl` and `desktopHost`. A new `RpcRequest` schema describes the `{method, payload}` envelope.
- **Server:** the `bin` entry in `apps/server/package.json`.
- **Build info:** the committed `tsconfig.tsbuildinfo` files; `*.tsbuildinfo` is ignored.

### Changed: toolchain, packages and the 3-day rule

[plans/002-toolchain-upgrade-and-ci.md](plans/002-toolchain-upgrade-and-ci.md), [docs/dependencies.md](docs/dependencies.md), [decision 006](docs/adr/006-toolchain.md)

- **Versions:** Node 26.13.1 (was `>=24`), bun 1.4.4 (was 1.3.9), TypeScript ~6.0.3 (held below 6.1 for typescript-eslint), turbo 2.11.11, effect 4.1.4 stable (from 4.0.0-beta.45), Vite 8.3.8 with `@vitejs/plugin-react` 6.3.0, Vitest 5.1.0 with `@vitest/coverage-v8` 5.1.0, tsdown 0.23.7, jsdom 31.0.1, `@testing-library/jest-dom` 7.0.1 (with `@testing-library/dom` 10.4.2), Tailwind 4.3.5, TanStack Router 1.170.46 and Query 5.107.1, React 19.3.0 exactly (held for Expo SDK 58), oxlint 1.93.0 and oxfmt 0.78.0 exactly. The lockfile advisories in `ws`, vite, vitest, turbo and effect are gone.
- **One place per version:** `.nvmrc` holds Node and `packageManager` holds bun; `engines`, `@types/node`, CI and the Dockerfile follow, and a test fails when they disagree. Every package version is in the root catalog.
- **The 3-day rule:** `bunfig.toml` sets `minimumReleaseAge`, so every install takes the newest release at least three days old. `dependency-holds.json` lists the packages held back, each with its reason.
- **Daily updates:** `.github/workflows/dependency-updates.yml` opens one pull request a day with every update the rule allows, including bun, Node and the Dockerfile's base images, and supersedes the previous one. It needs a GitHub App and two secrets (`DEPS_UPDATE_APP_CLIENT_ID`, `DEPS_UPDATE_APP_PRIVATE_KEY`); `bun run deps:update --dry-run` previews it. Dependabot updates GitHub Actions and refreshes image digests, with the same cooldown.
- **Fixed: the built server starts.** `apps/server/tsdown.config.ts` bundles the workspace packages, which export TypeScript source; before, `node apps/server/dist/bin.mjs` failed with `ERR_MODULE_NOT_FOUND`.
- **Tests:** a root `vitest.config.ts` with `test.projects` replaces `vitest.workspace.ts`, and `packages/shared` has tests.
- **Packages added over the rework**, each the newest the rule allowed: `pg`, `kysely` and `kysely-codegen` (server); `better-auth`, `@better-auth/expo`, `@better-auth/passkey` and `better-call` (auth); `i18next` 27.1.3 and `react-i18next` 18.0.2; the Expo SDK 58 family through `expo install`, `uniwind` 1.13.2 and `react-native-web` (mobile); and, for development only, `eslint` 10.15.0, `@eslint/js`, `typescript-eslint` 8.73.0, `eslint-plugin-sonarjs` 4.2.2, `eslint-plugin-i18next`, `knip`, `dependency-cruiser`, `@playwright/test` 1.65.1 and `@axe-core/playwright`. No AWS SDK, SES emulator or mail library.
- **Overrides:** `effect`, so one copy serves every workspace; `minimatch` `^11.0.8`, for an advisory in the version Expo's fingerprint tool and sonarjs ask for. `bun audit` reports nothing.

### Added: the hosted server core

[plans/003-hosted-server-core.md](plans/003-hosted-server-core.md), [docs/setup.md](docs/setup.md), [decision 001](docs/adr/001-effect-core-on-the-server.md)

- **Config:** one module built on Effect `Config` validates every variable at startup and reports every problem in one log line, never printing a secret. `.env.example` lists them all with development values.
- **Postgres:** `pg` and Kysely 0.29, a pool with timeouts and an error listener, generated database types (`kysely-codegen`, `bun run db:generate`). Migrations are numbered TypeScript files in an explicit list, run by a separate entry point (`apps/server/dist/migrate.mjs`, `bun run db:migrate`) under an advisory lock. The server never migrates, and refuses to start while a migration in its build is pending.
- **HTTP:** CORS only for `APP_URL`'s origin; a request body limit (413) and JSON required on `/rpc` (415); `X-Request-Id` and security headers on every response (a CSP on HTML, HSTS under https); a 500 never contains the error's message; unknown API paths answer 404 JSON and a wrong method 405; the client address honours `X-Forwarded-For` only behind `TRUSTED_PROXY_HOPS` proxies; static files are streamed with a containment check.
- **Health:** `GET /health` (liveness) and `GET /ready` (the database, and 503 while shutting down).
- **Lifecycle:** config, logger, database and HTTP server are Effect layers. SIGTERM drains requests for up to `SHUTDOWN_TIMEOUT_MS`, then closes the pool; exit 0 after a clean stop, 1 after a forced one or a failed start.
- **Logging:** one JSON object per line on stdout, filtered by `LOG_LEVEL`, with an access-log line per request.
- **RPC:** every method declares an auth level (`"public"`, `"session"` or `{ role }`) that one dispatcher enforces; error codes are constants in `ERROR_CODES`; a test fails when a contract has no handler.
- **Local development:** `docker-compose.local.yml` runs Postgres 18.7 on `127.0.0.1:54320`; `bun dev` starts it, migrates, and runs the server, the web app and the local inbox.
- **Tests:** a live-Postgres lane (`*.live.test.ts`, `bun run test:live`) with a throwaway schema per suite and a guard that `TEST_DATABASE_URL` names a `_test` database.

### Added: auth and email

[plans/004-auth.md](plans/004-auth.md), [docs/auth.md](docs/auth.md), decisions [002](docs/adr/002-better-auth-behind-an-allow-list.md) and [003](docs/adr/003-auth-features-on-by-default.md)

- **Better Auth 1.7.25** with `@better-auth/expo` and `@better-auth/passkey` on the same exact version, and `better-call` 1.4.5 declared directly (a test checks it equals the version `better-auth` uses). Email and password with verification, the `expo` plugin, the `admin` plugin (roles `user` and `admin`, the stock remove-user endpoint off) and passkeys. Its origin and CSRF checks are set on explicitly, since Better Auth turns them off when `NODE_ENV` is `test`.
- **Options** are built by one tested function: `ba_*` tables with snake_case columns and UUID ids, email links valid for one hour, sessions revoked on password reset, rate limits on in every environment and kept in the database, cookies prefixed `s10n-base.` and `Secure` under https.
- **Migration `001_auth`**, compared with Better Auth's own schema by a live test, both ways.
- **`/api/auth/*`** passes a route guard matched with Better Auth's own router, admitting only the routes `allowed-routes.ts` exposes, then a Node-to-Fetch bridge. A test fails when Better Auth serves a route nobody decided about.
- **`GET /api/app-auth/session`** returns the app-owned `AppSession`, and passes on the session cookie Better Auth renews once a session is a day old. `/rpc` and `/api/app-auth/*` refuse an untrusted `Origin` (403).
- **Email:** our own Amazon SES v2 client (a SigV4 signer verified against the AWS test suite, retries only when SES certainly did not accept the email, typed errors without secrets) behind `AuthEmailSender`. No AWS SDK.
- **Local inbox:** `bun run ses:local`, our own capture server, which `bun dev` starts: it checks each request's signature, keeps the last 200 emails, and serves an inbox at `http://127.0.0.1:8005/` and the emails as JSON at `/store`.
- **`bun run auth:set-role <email> <role>`** (and `dist/set-role.mjs` in the image) makes the first admin.

### Added: the web blank slate and the shared client, theme and i18n packages

[plans/005-web-blank-slate.md](plans/005-web-blank-slate.md), [docs/client.md](docs/client.md), [docs/i18n.md](docs/i18n.md), decisions [007](docs/adr/007-uniwind-and-a-shared-theme.md) and [008](docs/adr/008-example-domain.md)

- **Screens:** sign up, confirm the email, sign in with a password or a passkey, reset a password, a signed-in home, a profile page with passkey management, and an admin-only user list. Email links open these pages.
- **RPC methods:** `profile.get`, `profile.update` and `admin.listUsers` (admin role, keyset pagination with an opaque cursor; new error code `rpc.invalid_cursor`).
- **`packages/client`:** `createRpcClient({baseUrl})` with three failure kinds (`RpcError`, `DecodeError`, and `NetworkError`: no answer, outcome unknown), a session client, and a session gate that keys protected queries by user, purges cached data when the user changes, discards late answers, and settles security actions by re-reading the session.
- **`packages/theme`:** one Tailwind 4 token file for light and dark, in the format Uniwind requires, with a WCAG AA contrast test.
- **`packages/i18n`:** i18next with typed keys (a mistyped key fails `typecheck`), English catalogs in six namespaces, and a message for every error code.
- **Web app:** `VITE_API_BASE_URL` (optional, checked at build), `beforeLoad` guards with a same-origin redirect check, search params that stay strings, accessible forms, and a "could not confirm" state for every security action whose answer is lost.

### Added: the mobile blank slate (first boot on a Mac pending)

[plans/006-mobile-blank-slate.md](plans/006-mobile-blank-slate.md), [docs/mobile-dev.md](docs/mobile-dev.md)

**Written and tested on Linux; it has not been booted on any simulator or device.** The first boot on a Mac from a fresh clone is pending, with its checklist in [docs/mobile-first-boot.md](docs/mobile-first-boot.md).

- **The app:** Expo SDK 58 (React Native 0.88.1, expo-router, `expo-dev-client`), Uniwind on `packages/theme`, every string from `packages/i18n` in the device's language. The web app's screens except passkeys; email links open in the browser.
- **Auth:** Better Auth's Expo client keeps the session cookie in SecureStore under a key derived from the API origin; the session is re-read when the app returns to the foreground.
- **Config:** `app.config.ts` over a tested `buildExpoConfig`: `APP_VARIANT` picks name, URL scheme and bundle identifier from `packages/shared/src/app-variants.ts`, the one table the server reads too; `EXPO_PUBLIC_API_BASE_URL` must be https for preview and production. `eas.json` has development, simulator, preview and production profiles.
- **Shared code:** the auth helpers, form validation, error-message keys and the fake server for screen tests moved from `apps/web` to `packages/client`; the cookie prefix moved to `packages/shared/src/auth.ts`.
- **Checks:** `bun run mobile:export` bundles both platforms and checks the source maps (one React, the workspace from source, no test code); CI also generates the native projects and checks their identifiers.
- **Not included:** mobile passkeys (what they would need is in `docs/mobile-dev.md`), universal links, over-the-air updates and store submission.

### Added: quality gates

[plans/007-quality-gates.md](plans/007-quality-gates.md), [docs/quality.md](docs/quality.md), decisions [004](docs/adr/004-lint-stack.md) and [005](docs/adr/005-full-coverage.md)

- **One command:** `bun run agent:check` runs every gate that needs no database or browser, in order, stopping at the first failure. CI's first job runs it.
- **Lint:** oxlint with correctness, suspicious and performance rules as errors; ESLint with `typescript-eslint` strict and type-checked rules, sonarjs, size limits (complexity 10, cognitive complexity 15, depth 3, 4 parameters, no nested ternary) and `i18next/no-literal-string` in components. No suppression comment is allowed anywhere (`bun run lint:directives`).
- **Boundaries and dead code:** dependency-cruiser rules for which package may import which, each proved able to fire; knip in a normal and a production pass.
- **Coverage:** 100% of lines, branches, functions and statements in one merged report, with the database stopped; exclusions are a reviewed list, and an excluded entry point must be wiring only.
- **Audit:** `bun run deps:audit` compares `bun audit` with `dependency-audit-triage.json`.
- **Browser journeys:** `bun run test:e2e` runs two Playwright journeys in Chromium against the built server (sign up to sign out; a passkey with a virtual authenticator), with an axe check on every page and no console error allowed. Nothing is recorded or uploaded.
- **Fixed, found by the gates:** regular expressions with super-linear backtracking, tests that accepted any thrown error, unhandled rejections in the resend actions, Expo's over-the-air updates left on by default, a deprecated TanStack Query call, an uncaught EPIPE in the dependency update, and 52 unused exports.

### Added: the deployment kit

[plans/008-deployment-kit.md](plans/008-deployment-kit.md), [docs/deployment.md](docs/deployment.md), [decision 010](docs/adr/010-no-infrastructure-code.md)

- **The image:** `docker/Dockerfile`, with bases pinned by tag and digest at the versions in `.nvmrc` and `packageManager`. It holds the bundled server, the web build and only the server's run-time packages, runs as `node` on a read-only filesystem, and has three commands: the server, `migrate.mjs up` and `set-role.mjs`. `bun run docker:build` builds it; `bun run docker:smoke` runs it in production mode and checks it.
- **Two database roles:** `migrate` connects with `MIGRATION_DATABASE_URL` when set and grants `DATABASE_APP_ROLE` row access only, now and for later tables.
- **`APP_VERSION`:** a build argument `/config` reports.
- **The guide** names no host: environment tables tested against the config module, roles, migrating before a rollout, health and shutdown, proxies, several instances, email, the first admin.

### Added: conventions, docs and the rename script

[plans/009-conventions-and-docs.md](plans/009-conventions-and-docs.md), [docs/new-project.md](docs/new-project.md)

- **`AGENTS.md`** states the rules for changing the repository, naming the gate that enforces each; `CLAUDE.md` imports it, and `.claude/implement-plan.md` holds the notes for turning a plan into a pull request.
- **Commit attribution gate:** `bun run commits:attribution`, first in `agent:check`, fails when a commit message on the branch, or in CI the pull request's title or description, credits an AI tool. CI's first job checks out the whole history for it. `bun run hooks:install` runs the same check as a `commit-msg` hook, with no hook manager.
- **Rename script:** `bun run rename` gives a project its own names in one pass and checks the result; `bun run rename:proof` renames a copy and runs the install, `agent:check`, the build and the mobile export in it, as a fifth CI job. It replaces `CUSTOMIZATION_GUIDE.md`. The lockfile's root workspace now carries the repository's name, and a test that required the placeholder bundle domain now checks the variant table's shape.
- **Plans and decisions:** `plans/README.md` indexes the plans; `docs/adr/` holds a record for each of the ten decisions of the rework. A test keeps both indexes complete and numbers unique.
- **Docs:** a new README and `docs/README.md`; `docs/new-project.md`; the existing guides corrected where they no longer matched the code; and a test that every `bun run` command, relative link and anchor in the docs exists.
- **Fixed:** the dependency update's dry run left an empty temporary directory when git could not make its worktree; Vite warned on every build about an extensionless import in its config.
