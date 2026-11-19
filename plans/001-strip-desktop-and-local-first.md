# 001: Strip the desktop and local-first layer

> Status: implemented on 2026-11-19, branch `feature/001-strip-desktop-and-local-first`.

Phase 1 of [000](000-hosted-starter-rework.md). Source references such as `[S1]` are resolved in the private companion's README (`../s10n-base-private/README.md`); nothing from that directory is copied into this repo.

## 1. Goal

Remove everything that exists only because the scaffold began as a local desktop app, and the demo domain that sits on top of it. Nothing is added to replace it: Postgres, auth, hardening and the new example domain arrive in phases 3 to 5. Versions do not change: the upgrade is phase 2.

After this phase the repo is a small, honest skeleton:

- `apps/server`: a `node:http` server with `GET /health`, `GET /config`, a `POST /rpc` endpoint with an empty method registry, and static serving of the web build. No database, no WebSocket, no files written anywhere.
- `apps/web`: a shell with one home route that reads `/config`.
- `packages/contracts`: `base`, `bootstrap`, `rpc` (the contract type and an empty registry).
- `packages/shared`: unchanged.

Two projects built on this base each did this strip in one commit `[S1]`. Their commits also renamed, upgraded and added features; only the removals are followed here.

## 2. Out of scope

Leave these alone even though they are visibly wrong. Each has an owner phase, and fixing them here makes this PR harder to review.

| Not in this phase                                                                                                                                                                                                                     | Owner          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Any version change, `tsdown` bundling fix (defect 1), `vitest.workspace` migration, repo-wide reformat, CI                                                                                                                            | Phase 2        |
| Wildcard CORS, body limit, 500 responses that leak messages, static-path hardening, shutdown ordering, signal handling, `/config` deriving its URL from the `Host` header, config validation, `HOST`/`PORT`/`S10N_BASE_PORT` handling | Phase 3        |
| Auth on any route, auth levels on RPC methods                                                                                                                                                                                         | Phases 3 and 4 |
| Relative URLs in the web client (defect 6), a replacement example domain                                                                                                                                                              | Phase 5        |
| Lint rules, knip, coverage gate                                                                                                                                                                                                       | Phase 7        |
| Rewriting `README.md` and `CUSTOMIZATION_GUIDE.md`, `AGENTS.md`, rename script                                                                                                                                                        | Phase 9        |

No dependency is added in this phase.

## 3. Before changing anything: record the baseline

Plan 000 was written from reading code; nothing was run. On a fresh worktree at the default branch, before the first edit, run and record the result of each (pass, or the failure) in section 8:

1. `bun install --frozen-lockfile`. Note the local bun version against `packageManager` (`bun@1.3.9`); if they differ and the lockfile is rewritten, say so.
2. `bun run fmt:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.
3. Defect 1 from plan 000 ("the built server probably doesn't start"): after the build, run `node apps/server/dist/bin.mjs` with `S10N_BASE_HOME` pointed at a temp directory and a free `S10N_BASE_PORT`, and request `/health`. Record exactly what happens (starts and answers, or the error text). **Do not fix it**; phase 2 owns the fix. Only the observation is wanted.

If a gate already fails on the default branch for reasons unrelated to this phase (for example `fmt:check` on untouched files), do not repair it here. Record it, keep it from getting worse, and report it.

## 4. Changes

### 4.1 Delete outright

- `apps/desktop/` (all six tracked files).
- `scripts/wait-for-http.mjs` (its only caller was the desktop app; the `scripts/` directory goes with it).
- `EXTRACTION_REPORT.md`.
- Server: `apps/server/src/persistence/database.ts`, `apps/server/src/services/projectService.ts`, `apps/server/src/services/settingsService.ts`, `apps/server/src/ws/hub.ts`.
- Contracts: `packages/contracts/src/domain.ts`, `events.ts`, `settings.ts`.
- Web: `apps/web/src/routes/project.tsx`, `routes/settings.tsx`, `hooks/useActivityStream.ts`, `store/activityStore.ts`, `store/uiStore.ts`.
- The five tracked `tsconfig.tsbuildinfo` files (`apps/desktop`, `apps/server`, `apps/web`, `packages/contracts`, `packages/shared`): `git rm --cached`, then ignore (4.2).

### 4.2 Root files

- `package.json`
  - Remove scripts `dev:desktop` and `start:desktop`.
  - `clean`: drop `apps/*/dist-electron`.
  - Catalog: remove `electron`, `better-sqlite3`, `@types/better-sqlite3`, `ws`, `@types/ws`, `zustand`. Change no other entry.
- `turbo.json`: remove `S10N_BASE_HOME`, `S10N_BASE_SERVER_URL` and `VITE_DEV_SERVER_URL` from `globalEnv`; remove `dist-electron/**` from the build outputs.
- `.gitignore`: remove `dist-electron/`, `apps/*/dist-electron/`, `apps/server/.data/`, `apps/server/.logs/`; add `*.tsbuildinfo`.
- `.oxlintrc.json`: remove `dist-electron` from `ignorePatterns`.
- `bun.lock`: regenerate with `bun install` after the manifest edits. Read the lockfile diff: it must contain removals only (the six packages and what only they pulled in). If any remaining package changes version, stop and find out why before committing.
- `vitest.workspace.ts`: no change (phase 2 replaces it).

### 4.3 `packages/contracts`

- `src/index.ts`: export only `./base`, `./bootstrap`, `./rpc`.
- `src/base.ts`: remove `DeleteResult` (only the demo domain used it). Keep `Identifier`, `Timestamp`, `AppError`.
- `src/bootstrap.ts`: `BootstrapConfig` keeps `appName`, `appVersion`, `apiBaseUrl`. Remove `websocketUrl` and `desktopHost`.
- `src/rpc.ts`: keep `RpcContract`; export `defineRpc` (later phases call it from other modules). Remove `RPC_METHODS` entries, `EmptyPayload`, `EmptyInput` and all ten method contracts. Keep `rpcContracts` as an exported, empty, `readonly` registry typed so that phase 3 can add entries without changing its type. Add an `RpcRequest` schema for the envelope (`method: Schema.String`, `payload: Schema.Unknown`) so the server validates the envelope instead of casting it; this is what both source projects ended up with `[S1]`.
- `src/contracts.test.ts`: rewrite. Cover: `AppError` and `BootstrapConfig` decode a valid value; `BootstrapConfig` rejects a value missing a field; `RpcRequest` accepts `{method, payload}` and rejects a non-string `method`; `defineRpc` returns the method and schemas it was given; every method name in `rpcContracts` is unique (true for an empty list today, and a guard for phase 3).

### 4.4 `apps/server`

- `package.json`: remove the `bin` block; remove `better-sqlite3`, `ws`, `@types/better-sqlite3`, `@types/ws`.
- `src/config.ts`: remove `os` and `fs` use, `S10N_BASE_HOME`, `baseDir`, `dataDir`, `logDir`, `databasePath`, `settingsPath` and `ensureRuntimePaths`. The only path left is `webDistDir`. Keep `host`, `port` (still `S10N_BASE_PORT`, then `PORT`, then 4210), `appName`, `version` exactly as they behave today.
- `src/observability/logger.ts`: no file. Keep the `Logger` interface (`info`, `error`) and write one JSON line per entry (`at`, `level`, `message`, `meta` when given) to stdout. `createLogger` takes no directory argument; allow a writer to be injected so the test does not have to capture the real stdout.
- `src/server.ts`: remove the database, hub, both services, the `upgrade` listener and the `ensureRuntimePaths` call; `stop()` only closes the HTTP server; the `server_started` log no longer includes `baseDir`. Keep the `startServer(overrides)` signature and the `{config, port, stop}` result.
- `src/http/routes.ts`:
  - `RouteContext` is `{config, logger}`.
  - `/config` builds the three-field `BootstrapConfig`. Remove the `VITE_DEV_SERVER_URL` read and the `ws`/`wss` derivation.
  - `/rpc`: decode the body with `RpcRequest`. A body that is not valid JSON, or does not match the envelope, returns 400 with `AppError` code `rpc.invalid_request` and a fixed message. Any method returns 404 `rpc.method_not_found`, because the registry is empty. Keep `runRpc` only if something still calls it; otherwise delete it (phase 3 writes the real dispatcher).
  - Leave CORS, static serving and the 500 handler as they are (section 2).
- `src/bin.ts`: no change beyond what the imports force.
- Tests, written first:
  - `src/server.test.ts`: rewrite. Start on port 0 with no environment mutation. Assert: `/health` is 200 with `ok: true`; `/config` decodes with `BootstrapConfig` and has no `websocketUrl` or `desktopHost` key; `POST /rpc` with an unknown method is 404 `rpc.method_not_found`; `POST /rpc` with invalid JSON and with a non-string `method` is 400 `rpc.invalid_request`; `stop()` resolves and the port stops accepting connections; starting and stopping creates no file (run with `HOME` set to an empty temp directory and assert it is still empty afterwards).
  - `src/observability/logger.test.ts`: new. One line per call, valid JSON, expected fields, `meta` omitted when not given, and no `fs` write.
  - `src/config.test.ts`: new. Port precedence (`S10N_BASE_PORT`, `PORT`, default), host default and override, and that the resolved config has no data, log, database or settings path. Restore environment variables correctly: an originally unset variable must be deleted, not set to the string `"undefined"` (the old server test had that bug).
  - Tests must not depend on whether `apps/web/dist` exists. A local checkout may have it; a clean one does not.

### 4.5 `apps/web`

- `package.json`: remove `zustand`.
- `vite.config.ts`: remove the `/ws` proxy entry. Keep `/config`, `/health`, `/rpc`.
- `src/rpc/client.ts`: remove `connectActivityStream` and the `StreamMessage` import. Keep `getBootstrapConfig` and `callRpc`.
- `src/rpc/queries.ts`: reduce to `queryKeys.bootstrap` and `useBootstrapQuery`.
- `src/components/AppShell.tsx`: a plain frame: header with the app name, `children`, and a footer that shows the version from the bootstrap query once it has loaded. No sidebar, no forms, no stores.
- `src/routes/home.tsx`: a heading and one sentence that are true of the stripped scaffold (no mention of projects, notes or a live stream).
- `src/routes/root.tsx`: unchanged unless the shell's props force it.
- `src/router.tsx`: route tree is `home` only.
- `src/index.css`, `index.html`, `main.tsx`, `lib/http.ts`: unchanged.
- `src/router.test.tsx`: rewrite, test first. No `WebSocket` stub. The `/config` mock returns the three-field shape. Assert the home route renders inside the shell, the version appears after `/config` resolves, and navigating to the removed paths (`/settings`, `/projects/x`) does not render the old screens.

### 4.6 Docs

- `README.md` and `CUSTOMIZATION_GUIDE.md` are rewritten in phase 9. Here, only stop them from describing things that no longer exist: remove the desktop app, desktop commands, `S10N_BASE_HOME`, `S10N_BASE_SERVER_URL`, `VITE_DEV_SERVER_URL`, the runtime-directory layout, SQLite, the WebSocket endpoint and activity stream, Zustand, the demo domain, and the "Desktop Decision", "Settings Strategy" and "WebSocket Strategy" sections. Add one line near the top of the README saying the scaffold is being reworked and linking `plans/000-hosted-starter-rework.md`. Do not write new guidance.
- `CHANGELOG.md`: new, at the repo root. A short header and one "Unreleased" entry listing what this phase removed, written for someone maintaining a project created from the earlier scaffold.
- `plans/000-hosted-starter-rework.md`: update the status line to say phase 1 is implemented (with the date). If section 3 of this plan disproves or confirms a claim in plan 000 (defect 1, or a gate that does not pass as the old README says), correct plan 000 in this PR and say so in the PR description.

## 5. Order of work

Contracts first, then the server, then web, then root manifests and lockfile, then docs. Within each, the failing test comes before the change. Suggested commits: baseline notes and plan status; contracts; server; web; root manifests and lockfile; untrack build info; docs and changelog.

## 6. Verification

Run all of these on the final commit and paste the results into section 8 and the PR description. There is no CI workflow yet (phase 2 adds it), so these local runs are the only evidence.

1. `bun install --frozen-lockfile` succeeds from a clean `node_modules`.
2. `bun run fmt:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`: each passes, or is no worse than the recorded baseline with the reason stated.
3. `bun run dev:server` starts; `curl` of `/health` and `/config` returns the expected JSON; an RPC call returns the 404 envelope. Then stop it.
4. With `HOME` set to an empty temp directory, start and stop the dev server: the directory is still empty.
5. Repeat the defect 1 observation from section 3 on the stripped tree and record whether the outcome changed. Still no fix.
6. These print nothing:
   - `git ls-files | grep -E 'tsbuildinfo|^apps/desktop|dist-electron'`
   - `git grep -niE 'electron|better-sqlite3|sqlite|zustand|desktopHost|websocketUrl|S10N_BASE_HOME|S10N_BASE_SERVER_URL|VITE_DEV_SERVER_URL|wait-for-http' -- . ':!plans' ':!CHANGELOG.md' ':!bun.lock'`
   - `git grep -nE "from \"ws\"|WebSocket" -- apps packages`
   - `grep -nE '"(electron|better-sqlite3|ws|zustand|@types/ws|@types/better-sqlite3)@' bun.lock` (if `ws` is still present, name the remaining package that depends on it rather than forcing it out).
7. The scrub check from plan 000, run from the worktree, prints nothing.

## 7. Definition of done

- Everything in section 4 is done and nothing in section 2 was touched.
- Section 6 passes on the PR's head commit, with results recorded.
- `CHANGELOG.md` has the entry; plan 000 and this plan carry the right status.
- The lockfile diff is removals only.
- The PR description lists what was run and the results, the baseline findings, the defect 1 observation before and after, and anything left out with the reason.

## 8. How it was built

### Baseline on `main` (`af4ca30`), before any edit

Local tools: bun 1.4.4 (`packageManager` says `bun@1.3.9`) and Node 26.12.1.

| Step                            | Result                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | Pass, 334 packages. The lockfile was not rewritten despite the bun version difference.                                                                                                         |
| `bun run fmt:check`             | **Fail**, on one file: `plans/000-hosted-starter-rework.md`. oxfmt also checks Markdown and wants that plan's tables padded. Not repaired here (section 3); recorded as defect 10 in plan 000. |
| `bun run lint`                  | Pass, 0 warnings and 0 errors.                                                                                                                                                                 |
| `bun run typecheck`             | Pass, 5 tasks.                                                                                                                                                                                 |
| `bun run test`                  | Pass: contracts 2 tests, server 1, web 1.                                                                                                                                                      |
| `bun run build`                 | Pass, 5 tasks.                                                                                                                                                                                 |

### Defect 1

**Before** (on `main`, after the baseline build): `S10N_BASE_HOME=<empty temp dir> S10N_BASE_PORT=47811 node apps/server/dist/bin.mjs` exits with code 1 at once, and `/health` is refused. The error:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>/packages/contracts/src/base' imported from <repo>/packages/contracts/src/index.ts
```

Plan 000's claim holds, with a sharper cause: Node 26 strips types and loads `packages/contracts/src/index.ts` itself, then fails on its extensionless relative import `./base`. The crash is at module resolution, so nothing was created in the temp directory. Plan 000 is corrected accordingly.

**After** (on this branch, same command with `HOME` pointed at an empty temp directory): the same error and exit code 1; nothing created. The bundle's only external imports are now `effect` and `@s10n-base/contracts`. Not fixed; phase 2 owns it.

### Decisions and departures

- **RPC envelope:** `RpcRequest` requires both keys, so `{method}` without `payload` is a 400. An empty body is a 400 too (it used to be read as `{}` and answered with a 404 for method `undefined`), and invalid JSON is a 400 (it was a 500). The 404 message still names the method, as before.
- **Config shape:** `ServerConfig.paths` stays an object holding only `webDistDir` (the interface is renamed `ServerPaths`), so static serving in `routes.ts` is untouched.
- **Logger:** both levels go to stdout as JSON lines, as section 4.4 asks; errors used to go to stderr. `bin.ts` still prints its plain "listening" line.
- **`@s10n-base/shared`:** nothing in `apps/server` imports it any more, but section 4.4 does not list it, so the dependency stays. Knip (phase 7) will flag it.
- **Build info:** the desktop `tsconfig.tsbuildinfo` went with `apps/desktop`; the other four are untracked.
- **Section 6 grep:** the tests that check the removed bootstrap fields compare the exact set of keys instead of naming the removed fields, so the grep stays empty.
- **Removed web paths:** `/settings` and `/projects/x` now match only the root route (the router's not-found view inside the shell) and make no RPC call.
- **Formatting:** `turbo.json` and this plan are formatted with oxfmt (whitespace and table padding only), so `fmt:check` is no worse than the baseline. Plan 000 is left unformatted (section 3).
- **Nothing in section 2 was touched.** CORS, the body handling outside `/rpc`, static serving, the 500 handler, `/config`'s use of the `Host` header and the env handling are as they were.

### Verification on the final commit (section 6)

1. `bun install --frozen-lockfile` after `bun run clean`: pass, 238 packages, lockfile unchanged.
2. `fmt:check`: fails on `plans/000-hosted-starter-rework.md` only, the same as the baseline. `lint`: pass, 0 warnings and 0 errors. `typecheck`: pass, 4 tasks. `test`: pass, contracts 11 tests, server 21, web 4. `build`: pass, 4 tasks.
3. `S10N_BASE_PORT=47812 bun run dev:server`: `/health` gave 200 `{"ok":true,"status":"ok"}`; `/config` gave 200 `{"appName":"S10N Base","appVersion":"0.0.0","apiBaseUrl":"http://127.0.0.1:47812"}`; `POST /rpc` with `{"method":"example.get","payload":{}}` gave 404 `{"ok":false,"error":{"code":"rpc.method_not_found","message":"Unknown RPC method example.get"}}`; invalid JSON gave 400 `rpc.invalid_request`. Once the server was stopped, the port refused connections.
4. Empty `HOME`: **not literally empty.** After starting and stopping `bun run dev:server`, `HOME` held `.bun/install/cache/` (bun's runtime transpiler cache) and `.config/turborepo/telemetry.json` (turbo), even with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` and `TURBO_TELEMETRY_DISABLED=1`. Running `bun run src/bin.ts` directly left only `.bun/install/cache/`. Nothing came from the server: no `.s10n-base` directory and no database, settings or log file. The server test "creates no file when it starts and stops" checks the server code alone and passes.
5. Defect 1: unchanged, as above.
6. The first three greps print nothing. The lockfile grep prints `ws@8.20.0`; `jsdom` (the web test environment) is the only package that still depends on it.
7. Scrub check: prints nothing.

### For later phases

- **Phase 2:** bun 1.4.4 installs the 1.3.9 lockfile without rewriting it. oxfmt checks Markdown, so the reformat must include `plans/`.
- **Phase 3:** `bun run dev:server` exits with turbo reporting `run failed` on SIGTERM, because the server has no signal handling. Server tests print the logger's JSON lines; an injected writer can silence them.
- **Phase 7:** the unused `@s10n-base/shared` dependency in `apps/server`. jsdom prints `Not implemented: window.scrollTo` in the web tests, as it did before this change.
