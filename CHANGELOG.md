# Changelog

Scaffold-level changes to S10N Base, newest first. Projects created from an earlier version of the scaffold do not receive these changes automatically; use this file to decide what to port.

## Unreleased

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
