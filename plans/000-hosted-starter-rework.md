# 000: Rework s10n-base into a hosted web and mobile starter

> Status: approved by the owner on 2026-11-18. **Phases 1 to 9 are implemented** on one pull request (PR #1), each recorded in its own plan:
>
> - Phase 1 implemented on 2026-11-19 ([001](001-strip-desktop-and-local-first.md)).
> - Phase 2 implemented on 2026-11-19 ([002](002-toolchain-upgrade-and-ci.md)).
> - Phase 3 implemented on 2026-11-19 ([003](003-hosted-server-core.md)).
> - Phase 4 implemented on 2026-11-19 ([004](004-auth.md)).
> - Phase 5 implemented on 2026-11-19 ([005](005-web-blank-slate.md)).
> - Phase 6 implemented on 2026-11-19 ([006](006-mobile-blank-slate.md)); **first boot on a Mac pending** ([docs/mobile-first-boot.md](../docs/mobile-first-boot.md)), so not done.
> - Phase 7 implemented on 2026-11-19 ([007](007-quality-gates.md)).
> - Phase 8 implemented on 2026-11-20 ([008](008-deployment-kit.md)).
> - Phase 9 implemented on 2026-11-20 ([009](009-conventions-and-docs.md)).
> - Phase 10 **not started**: its backport plans are written in each existing project's own repository, not here.
>
> What remains is the owner's: boot the mobile app on a Mac from a fresh clone; create the dependency-update GitHub App, install it, add its two secrets and run the workflow once by hand ([docs/dependencies.md](../docs/dependencies.md#setting-up-the-github-app)); turn on the repository's "Template repository" setting; look at the web screens in light and dark mode; merge the pull request; and phase 10.

Written 2026-11-18 from a review of three private projects built on this base (called Project A, B and C here), of s10n-base itself, of T3 Code upstream, and of the npm registry.

**This is the public version of the plan.** The projects it draws on are private, so they are not named, and source references are given as labels such as `[S4]`. The full plan, the research reports, the key to the labels (which repo, file and commit each one points to) and the scrub denylist live in a private companion directory outside this repo, at `../s10n-base-private/` next to the checkout. Read `../s10n-base-private/README.md` before starting a phase. Nothing from that directory may be copied into this repo without scrubbing.

**How far to trust this:** every finding comes from reading code, git history and the npm registry. Nobody installed, built or ran anything. Version numbers are registry data as of 2026-11-18 and must be re-checked on the day the upgrade is done. Phase 1 recorded a real baseline on 2026-11-19 (plan 001, section 8): it confirmed defect 1 and found defect 10.

## 1. Summary

s10n-base today is a 3,172-line scaffold that still looks like a local desktop app: Electron host, SQLite, settings and logs in the home directory, no auth, wildcard CORS. Every spin-off spent its first days undoing the same things and adding the same things. The plan is to do that work once, in the base.

The target is a hosted, multi-user starter:

- **Apps:** `apps/server` (Node HTTP, Postgres), `apps/web` (React + Vite), `apps/mobile` (Expo). No desktop app.
- **Packages:** `contracts`, `shared`, a new `client` (API client and session state shared by web and mobile), and `theme` (design tokens for both).
- **Built in:** Better Auth, local email through SES local, Postgres with Kysely migrations, an RPC layer where every method declares its auth level, a blank-slate signed-in app on web and mobile, CI, quality gates, a Dockerfile and agent conventions.
- **Current packages:** everything moved to the newest stable release that is at least 3 days old.

## 2. What the three projects have in common

"3 of 3" patterns go into the base without further debate. Project B patterned its scaffold on Project A, so agreement between those two is partly inheritance; Project C is the more independent data point.

| Pattern | A | B | C | Into the base? |
|---|---|---|---|---|
| Postgres with `pg` + Kysely, replacing SQLite | yes | yes | yes | Yes |
| Numbered hand-written TypeScript migrations, run from a separate entry point | yes | yes | yes | Yes |
| Tests against a real Postgres | yes | yes | yes | Yes |
| Better Auth 1.7.x, pinned exactly | 1.7.16 | 1.7.14 | 1.7.14 | Yes |
| Auth tables written as our own migrations, with a test comparing them to Better Auth's schema | yes | yes | yes | Yes |
| Plain `node:http` server; Effect used only for `Schema`, on stable 4.x | 4.1.2 | 4.0.7 | 4.0.3 | Yes, plus Effect core (D1) |
| `POST /rpc` contract kept | yes | yes | yes | Yes |
| Auth level required on every RPC method | partly | yes | yes | Yes |
| Demo Projects/Notes domain deleted | day 1 | day 1 | day 1 | Replace it |
| Committed `*.tsbuildinfo` removed | yes | yes | yes | Yes |
| Wildcard CORS, missing body limit, missing graceful shutdown fixed | yes | yes | yes | Yes |
| Email through AWS SES v2 with `aws-ses-v2-local` in dev | yes | yes | yes | Yes, as a module |
| SHA-pinned GitHub Actions, CI with a Postgres service | yes | yes | yes | Yes |
| `plans/NNN-slug.md` convention | yes | yes | yes | Yes |
| Desktop app removed | kept, unshipped | removed | removed | Remove |
| WebSocket hub removed | kept, unused | removed | removed | Remove |
| Expo SDK 58 + expo-router + SecureStore cookie auth | yes | yes | no mobile | Yes |
| `ba_`-prefixed snake_case auth tables with UUID ids | yes | yes | no | Yes |
| Node-to-Fetch bridge mounting Better Auth at `/api/auth` | yes | yes | no (private provider) | Yes (D2) |
| App-owned session route at `/api/app-auth/*` | yes | yes | own routes | Yes |
| ESLint + sonarjs, knip, dependency-cruiser on top of oxlint | yes | yes | oxlint only | Yes (D4) |
| 100% coverage gate and one `agent:check` script | yes | yes | no | Yes (D5) |
| Shared client-state package for web and mobile | yes | no | n/a | Yes; upstream T3 Code does the same |
| Dockerfile in the app repo | in infra repo | none | yes | Yes |
| Node 26 and bun 1.4.4 | Node 24, bun 1.3.9 | yes | yes | Yes |

## 3. Defects in the base today

These are bugs, separate from the desktop assumptions. The first one was found by reading the config and confirmed by running it in phase 1; Project B fixed the same thing in its first 48 hours.

1. **The built server doesn't start** (confirmed 2026-11-19 on Node 26.12.1; **fixed in phase 2**, and CI's smoke test now checks it). `apps/server/tsdown.config.ts` has no setting to bundle workspace packages, and `packages/contracts` exports TypeScript source, so `dist/bin.mjs` imports raw `.ts`. Node 26 strips the types and loads that file, then exits with `ERR_MODULE_NOT_FOUND` on its extensionless relative import `./base`.
2. **Five `tsconfig.tsbuildinfo` files are committed.** All three spin-offs inherited and later removed them.
3. **No auth on `/rpc`, `/ws` or `/config`**, CORS is `*`, there is no request body limit, and 500 responses leak error messages. **Partly fixed in phase 3:** CORS allows only `APP_URL`'s origin, bodies are limited, a 500 sends a fixed message, every RPC method declares an auth level that one dispatcher enforces, and `/config` no longer trusts request headers; `/ws` went in phase 1. **Fixed in phase 4:** the RPC caller comes from the Better Auth session, `/rpc` and `/api/app-auth/*` refuse untrusted `Origin` headers, and `/api/auth` sits behind a route allow-list.
4. **The database closes before requests drain** on shutdown, and there is no shutdown deadline. **Fixed in phase 3:** Effect layers release the HTTP server (drain, then force-close at `SHUTDOWN_TIMEOUT_MS`) before the pool.
5. **SQLite tables are created on every boot** with no migrations and no owner column. **Fixed in phases 1 and 3:** SQLite went in phase 1; Postgres has numbered migrations run by a separate entry point, and the server never migrates on startup. Owner columns arrive with the first tables (phase 4 onwards).
6. **The web client uses relative URLs**, which a mobile app can't use. **Fixed in phase 5:** `packages/client` takes an explicit base URL (`VITE_API_BASE_URL` on the web, the page's origin by default), and the relative-URL client is gone.
7. **Lockfile versions carry known advisories:** `ws` 8.20.0, vite 7.3.2, vitest 4.1.4, turbo 2.9.6, effect beta.45 and electron 40.6.0. **Fixed in phases 1 and 2:** electron went in phase 1; `ws` left the lockfile with jsdom 31; the rest moved past their advisories. Phase 2 also cleared a `source-map-js` advisory the old lockfile kept, and `bun audit` reports nothing.
8. **Docs are wrong.** `EXTRACTION_REPORT.md` describes path helpers and log rotation that don't exist, and the rename checklist misses the `S10N_BASE_*` env vars, the localStorage key, the page title and the bin name. **Fixed in phases 1, 3 and 9:** the report, the bin entry, the persisted web store and two of the env vars went in phase 1, and `S10N_BASE_PORT` in phase 3; phase 9 replaced the checklist with `bun run rename`, which a CI job proves on a renamed copy, rewrote the README, and corrected the docs that had gone stale.
9. **Uses the deprecated `vitest.workspace` file** and leaves `packages/shared` out of it. **Fixed in phase 2:** a root `vitest.config.ts` with `test.projects`, and `packages/shared` has tests.
10. **`fmt:check` fails on the default branch** (found 2026-11-19). oxfmt also checks Markdown, and this plan's tables are not in its format. Fixed the same day: `plans/` is excluded from formatting in `.oxfmtrc.json` (owner decision), so plan files are never reformatted by the tool.

## 4. Decisions (settled with the owner, 2026-11-18)

| # | Question | Decision |
|---|---|---|
| D1 | How much Effect | `Schema` for contracts, plus Effect's stable core on the server: `Layer`/`Scope` for startup and shutdown order, `Config` for env validation, `Schedule` for retries and timeouts. HTTP and RPC stay on `node:http`. |
| D2 | How Better Auth is exposed | Mounted at `/api/auth` through the Node-to-Fetch bridge with a route allow-list. App-owned routes under `/api/app-auth/*`. |
| D3 | Auth features on by default | Email and password with verification, the `expo` plugin, the `admin` plugin, and passkeys. The organization plugin and social sign-in are documented recipes. |
| D4 | Linting | oxlint, type-checked ESLint with sonarjs, knip and dependency-cruiser. |
| D5 | Coverage | 100% gate on by default, threshold in one place. |
| D6 | Toolchain | Stay on bun 1.4.4, turbo and TypeScript ~6.0.3. The 3-day rule is enforced by bun's `minimumReleaseAge`. |
| D7 | Mobile styling | Uniwind with a shared `packages/theme` token file. |
| D8 | Example domain | Account profile on web and mobile, plus a small admin-only user list to prove the role guard. |
| D9 | Existing repos | The new base is a template for new projects. It keeps a changelog, and each existing repo gets a backport plan. |
| D10 | Infrastructure as code | Terraform. Alchemy was evaluated and rejected as not stable enough (a beta rewrite with frequent breaking changes and no providers for our platforms). The base itself ships no infrastructure code and stays hosting-neutral. |

Notes on the decisions:

- **D1 is new ground.** No repo of ours uses Effect beyond `Schema`, so this is the part of the base with no pattern to copy. It rests on the bug history: all three repos hand-fixed shutdown ordering and config validation. T3 Code upstream is the reference for how layers are written; it is on 4.1.3.
- **D3, passkeys:** Project A and Project C use `@better-auth/passkey`; Project B does not. It is a third package that must stay version-locked with `better-auth` and `@better-auth/expo`. Neither repo with passkeys has a verified native mobile passkey flow (Project A's native builds are unverified, Project C has no mobile app), so the base ships passkeys on web first and mobile passkey support is a named open item in phase 6.
- **D3, admin:** only Project B uses the `admin` plugin, with `defaultRole: "user"` and `adminRoles: ["admin"]`, and disables `/admin/remove-user` in favour of its own guarded route. Copy that setup.
- **D6, toolchain triggers** (detail in the companion `[S9]`):
  - **pnpm 12:** revisit if we adopt Vite+ or bun causes Expo or EAS trouble. Upstream's measured CI gain was almost all install time and it broke release builds four times on pnpm details.
  - **Vite+:** revisit when it has a documented remote cache and a couple of months of non-breaking releases. Adopting it means rewriting every test import to `vite-plus/test`, and it has no documented Expo story.
  - **TypeScript 7:** revisit when 7.1 is stable and typescript-eslint supports it. Until then keep the base on TypeScript 6.0 with zero deprecation warnings, because 7 turns those into errors.
- **D4 and D6 are linked:** keeping typescript-eslint is what holds TypeScript below 6.1.

## 5. Target shape

```
apps/
  server/    node:http, Postgres (Kysely), Better Auth, RPC, migrate entry, worker entry
  web/       React 19 + Vite 8 + TanStack Router/Query + Tailwind 4
  mobile/    Expo SDK 58 + expo-router + Uniwind, dev client
packages/
  contracts/ Schema-based entities, RPC methods with auth levels, AppSession, error codes
  shared/    small cross-runtime helpers
  client/    RPC client with configurable base URL, session-gated query state
  theme/     Tailwind 4 token file used by web and mobile
  i18n/      i18next setup and locale catalogs for web, mobile and emails
docker/      Dockerfile, compose for local Postgres and SES-local
plans/       NNN-slug.md
docs/        setup, auth, mobile dev, deployment
.github/     ci.yml, dependabot.yml
AGENTS.md, CLAUDE.md
```

## 6. Phases

Each phase is one PR-sized plan and ends with the gates passing. Order matters: 1 and 2 unblock everything, 3 before 4, 4 before 5 and 6.

### Before phase 1: repo setup

Owner decisions, 2026-11-18:

- **Done:** the base now lives at `TawnyDogSoftware/s10n-base` (public), created as a new repo with the existing history pushed to it. One org-owned GitHub App and one set of org secrets can then serve the base and every project created from it. The earlier personal copy is superseded.
- **Done:** the private companion lives at `TawnyDogSoftware/s10n-base-private`.
- **It stays public** (owner decision, 2026-11-18). The spin-offs are private, so everything brought over from them is scrubbed first: product and company names, domains, bundle ids, URL schemes, cookie prefixes, env var prefixes, email addresses, infrastructure details, and plan or doc text that describes the products. Commit messages and PR descriptions in the base must not name them either.
- **Scrub check:** every phase's PR is checked against a denylist of those terms before it is pushed: `grep -rniwf ../s10n-base-private/denylist.txt .` (excluding `.git` and `node_modules`) must print nothing. The denylist lives in the private companion, since a list of private project names committed to a public repo would defeat the purpose. The full plan and the research reports stay there for the same reason.
- **Template repo** (owner decision, 2026-11-18): after the rework lands, turn on GitHub's "Template repository" setting so new projects start from "Use this template" with a clean history. This fits D9: new projects don't merge from the base, they read its changelog.
- At phase 2, the owner creates the dependency-update GitHub App in the org (walkthrough to be given then). Store its credentials as org-level secrets limited to selected repos, since a repo created from a template copies workflows but not secrets.

### Phase 1: strip the desktop and local-first layer

Projects B and C each did this in a single commit; those commits are the file lists to follow `[S1]`.

- Delete `apps/desktop`, the `dev:desktop` and `start:desktop` scripts, `scripts/wait-for-http.mjs`, and `dist-electron` in `.gitignore`, `.oxlintrc.json`, `turbo.json` and the `clean` script.
- Remove `desktopHost` from the bootstrap contract, the server routes and the web test.
- Delete SQLite persistence, the WebSocket hub, the file logger, `settings.json`, the `S10N_BASE_HOME` data and log directories, and the `bin` entry.
- Remove `electron`, `better-sqlite3`, `ws`, `zustand` and their `@types` from the catalog. No spin-off uses zustand.
- Delete the Projects/Notes/activity demo domain.
- Untrack `*.tsbuildinfo` and add it to `.gitignore`.
- Delete `EXTRACTION_REPORT.md`; the README and customization guide are rewritten in phase 9.

### Phase 2: toolchain and package upgrade, plus minimal CI

Targets follow the 3-day rule as of 2026-11-18. The full table and changelog links are in the companion `[S3]`.

| Area | From | To | Note |
|---|---|---|---|
| bun | 1.3.9 | 1.4.4 | Project B and Project C already pin it |
| Node | >=24 | 26.13.1 (LTS since 2026-10-28) | pin in `.nvmrc` and `engines`; `@types/node` 26.6.6 |
| TypeScript | ^5.9.3 | ~6.0.3 | **Deviation from the rule.** 7.0.2 is the newest stable, but typescript-eslint caps at <6.1.0, Expo's template uses ~6.0.3 and no repo of ours is on 7. See D6. |
| turbo | ^2.5.8 | 2.11.13 | patch exception |
| effect | 4.0.0-beta.45 | 4.1.4, exact | stable since 2026-10-01 |
| vite / plugin-react | 7 / 5 | 8.3.8 / 6.3.0 | major; Project B has done this upgrade `[S2]` |
| vitest + coverage-v8 | 4 | 5.1.1, exact and equal | major; patch exception; move to `test.projects` |
| tsdown | 0.20 | 0.23.7 | add the workspace bundling setting (`deps.alwaysBundle`) to fix defect 1 |
| jsdom | 26 | 31.0.1 | major with a rewritten CSS engine; fall back to 30.1.3, which Project B runs, if tests break |
| jest-dom | 6 | 7.0.1 | needs `@testing-library/dom` as a peer |
| tailwind + `@tailwindcss/vite` | 4.1 | 4.3.5 | |
| TanStack Router / Query | 1.133 / 5.90 | 1.170.46 / 5.107.1 | |
| oxlint / oxfmt | 1.55 / 0.40 | 1.93.0 / 0.78.0 exact | expect a repo-wide reformat; do it as its own commit |
| React and react-dom | ^19.2.0 | 19.3.0, exact | **Deviation from the rule.** 19.3.1 is newest, but Expo SDK 58 pins 19.3.0, and one React across web and mobile avoids duplicates. Project B does this. |

**Phase 2 outcome (2026-11-19):** the table held except for turbo (2.11.11) and vitest with coverage-v8 (5.1.0). Neither patch exception was taken: turbo 2.11.12 and 2.11.13 fix affected-task detection, watch mode and `turbo trace`, none of which this repo uses, and both releases become eligible on 2026-11-21 through the daily update. oxfmt 0.78.0 changed no file, so there was no reformat. The final table and every check are in plan 002, section 10.

Also in this phase:

- A minimal `ci.yml`: frozen install, format check, lint, typecheck, test, build, then start the built server and hit `/health`. That last step would have caught defect 1.
- Dependabot for GitHub Actions and Docker only, since it cannot update a bun `catalog`. Set its `cooldown` to 3 days so it follows the same rule (confirmed in phase 2: `cooldown.default-days`). Docker entries arrive with the phases that add Docker files.
- The daily dependency-update workflow described below.
- Enforce the 3-day rule in the package manager: `[install] minimumReleaseAge = 259200` (seconds) in `bunfig.toml`. **Decided 2026-11-18.** Tested on bun 1.4.4 in a throwaway project: with the setting, `bun add knip` installed 6.45.1 (7 days old) instead of 6.46.0 (published that day). The patch exception then needs a per-package override or a temporary lift, documented in the README. **Phase 2 found** the per-package setting is `minimumReleaseAgeExcludes` in `bunfig.toml`, and that it covers only the packages named: dependencies published with them must be listed too, and blocked platform binaries (oxlint, turbo) are skipped without an error. See `docs/dependencies.md`.
- An `auth-stack` note in the docs: `better-auth`, `@better-auth/expo` and `better-call` move together.

#### Daily dependency-update workflow

Owner decision, 2026-11-18: a scheduled GitHub Action opens a PR with every update the 3-day rule allows. Tested locally on bun 1.4.4 in a throwaway workspace; the workflow itself has not been run.

What the test showed:

- `bun update` honours `minimumReleaseAge` from `bunfig.toml`, rewrites the root `catalog`, and stays inside each range. Exact pins are left alone.
- `bun update --latest` also honours the age gate, crosses major versions, and moves exact pins while keeping them exact (`effect` 4.0.3 became 4.1.4; `jsdom` ^30 became ^31.0.1; `knip` stayed at 6.45.1 because 6.46.0 was a day old).
- `bun outdated` marks versions held back by the age gate with `*`.
- `--minimum-release-age-excludes=<pkg>` lifts the gate for named packages, which is how a bug-fix patch is taken early. (Phase 2: true, but only for the packages named, not their dependencies.)
- (Phase 2, not in the original test) `bun update --latest <names>` and `bun update --latest '!<name>'` do **not** rewrite catalog entries on bun 1.4.4; only an unfiltered `bun update -r --latest` does.

Design (`.github/workflows/dependency-updates.yml`), revised with the owner on 2026-11-18:

- **Trigger:** `cron: "0 0 * * *"` plus `workflow_dispatch`. GitHub can start scheduled runs late at busy times such as the top of the hour, so "midnight UTC" means shortly after.
- **One PR with everything the rule allows:** `bun update -r --latest` minus the hold list, so majors are included. (Phase 2: bun's filters cannot exclude catalog entries, so the script updates everything, then restores held packages and reinstalls.) When a major breaks CI, the fix is made on that PR's branch (by a person or an agent) and merged with it; the base is expected to keep up with majors.
- **Supersede, don't pile up.** Each run:
  1. Looks for an open PR with the `dependency-update` label.
  2. Builds today's result. If there is an open PR, the new branch starts from that PR's head with `main` merged in, so fix commits already pushed for a major carry forward. If that merge conflicts, it starts from `main` and says so.
  3. If today's result is identical to the open PR, it stops and leaves the PR alone. Otherwise a new PR would appear every day with nothing new in it.
  4. Otherwise opens a new PR on `deps/update-YYYY-MM-DD`, comments on the old PR with a link to the new one, closes the old PR and deletes its branch.
- **bun and Node are part of the same PR.**
  - **bun:** newest stable release at least 3 days old, from the `oven-sh/bun` GitHub releases.
  - **Node:** newest release at least 3 days old on the current LTS line, from `nodejs.org/dist/index.json`. A new LTS major is flagged in the PR body, not applied, because it also means a new `@types/node` major and a new Docker base image.
  - **`@types/node`:** kept on the same major as Node.
  - **Prerequisite:** phase 2 makes each version single-sourced (`.nvmrc`, and `packageManager` in the root `package.json`), with `engines`, CI (`node-version-file`, `bun-version-file`) and the Dockerfile reading from those. Then the PR never has to edit workflow files, and the app needs no `workflows` permission.
- **Hold list** in one checked-in file with a reason per entry, enforced by a test:
  - `react`, `react-dom`, `react-native` and every Expo-managed native module: owned by the Expo SDK. The job runs `bunx expo install --check` in `apps/mobile` and reports drift instead of taking npm latest. A new Expo SDK is flagged in the PR body.
  - `typescript`: held below 6.1 until typescript-eslint supports 7 (D4, D6).
  - `better-auth`, `@better-auth/expo`, `@better-auth/passkey`, `better-call`: updated only together, as one group. (Phase 2: `better-call` has its own version numbers, 1.4.5 against better-auth's 1.7.25, so it cannot share a same-version group. It is held on its own and moved by hand with the group; phase 4's version test covers it.)
  - `kysely`: held on 0.29.x, the range Better Auth supports.
- **PR body:** version changes grouped as major, minor and patch; bun and Node changes; anything flagged but not applied; and the packages `bun outdated` shows as held back by the age gate. That last list is where a person applies the patch exception by hand with `--minimum-release-age-excludes`; judging whether a patch "fixes an actual bug" is not automated.
- **Token:** a GitHub App installation token from `actions/create-github-app-token`. A PR opened with the default `GITHUB_TOKEN` does not trigger CI. App permissions: Contents read and write, Pull requests read and write, nothing else. Secrets: `DEPS_UPDATE_APP_CLIENT_ID` and `DEPS_UPDATE_APP_PRIVATE_KEY` (phase 2 renamed the first from `DEPS_UPDATE_APP_ID`, because `app-id` is deprecated in `actions/create-github-app-token` 3.3.0 in favour of `client-id`).
- **Hardening:** SHA-pinned actions, job `permissions: contents: read` (the app token does the writing), `bun install --ignore-scripts` during the update, a concurrency group.
- **Not covered:** GitHub Actions versions, which Dependabot handles, and the digests of the container image's pinned base tags, which Dependabot refreshes. (Phase 8: the workflow moves the Dockerfile's Node and bun tags, with their digests, together with `.nvmrc` and `packageManager`, since a test requires them to agree; Dependabot ignores version moves of those two images.)
- **Public-repo caveat:** s10n-base is a public repo, and GitHub disables scheduled workflows in public repos after 60 days without repository activity. Merging the update PRs counts as activity; a long quiet spell would need the workflow re-enabled.

To re-check on the day: `expo` 58.0.26 (eligible from 2026-11-20), oxlint 1.94.0, oxfmt 0.79.0, react-query 5.108.0, knip 6.46.0, dependency-cruiser 18.8.0, typescript-eslint 8.73.0.

### Phase 3: hosted server core

- **Config:** one config module built on Effect `Config` (D1) that reports every problem at once, with `APP_URL` as the single public origin, `PORT`, `0.0.0.0` binding and `DATABASE_URL`. Ship `.env.example`.
- **Database:** Postgres 18 with `pg` and Kysely 0.29.9, `kysely-codegen` for types, a pool error listener and timeouts.
- **Migrations:** numbered append-only TypeScript files run by a separate `migrate` entry point under an advisory lock. The API never migrates on startup.
- **HTTP hardening:** allow-list CORS from `APP_URL`, request body limit, trusted-proxy client IP, security headers, errors that don't leak internals, same-origin static serving of the web build.
- **Lifecycle:** `/health` (liveness) and a readiness check that pings the database; SIGTERM drains requests before closing the pool, with a deadline. Built on Effect `Layer`/`Scope` (D1), so resources release in reverse order of acquisition.
- **Logging:** structured JSON to stdout only.
- **RPC:** keep `POST /rpc` with the `{method, payload}` envelope. Every contract method declares `auth` (`public`, `session`, or a role), enforced in one dispatcher before the payload is decoded, with typed `unauthenticated` and `forbidden` errors. An exhaustiveness test fails if a method has no handler.
- **Tests:** a live-Postgres lane with a throwaway schema per suite, a guard that the test URL ends in `_test`, and a sweeper for leftover schemas.
- **Phase 3 outcome (2026-11-19):** done as planned, with the departures recorded in plan 003, section 11. Two findings matter beyond this phase: Effect 4.1's `Config` stops at the first invalid variable, so the config module collects errors itself on top of per-variable `Config`s; and Kysely creates its bookkeeping tables before taking its own migration lock, which is why the migrator holds a separate advisory lock.
- **Local dev:** `docker-compose.local.yml` with Postgres, and one `bun dev` that starts the database, server and web.

### Phase 4: auth

Project B has the smallest clean versions of the options builder and the bridge to copy from `[S4]`.

- `better-auth`, `@better-auth/expo` and `@better-auth/passkey` at 1.7.25, pinned exactly and moved together. Our repos have run 1.7.14 to 1.7.16, so 1.7.25 is untested by us.
- A pure, unit-tested options builder: Kysely adapter with snake casing, `ba_`-prefixed tables, UUID ids, database-backed rate limit, telemetry off, secure cookies derived from `APP_URL`, trusted origins from `APP_URL` plus the mobile URL schemes (and `exp://` in development only).
- Auth tables as our own migration, with a live test that compares them to Better Auth's expected schema.
- Plugins: `expo`, `admin` (default role `user`, admin role `admin`, stock remove-user endpoint disabled) and `passkey` (D3).
- The Node-to-Fetch bridge at `/api/auth`, with a body cap and multiple `Set-Cookie` preserved.
- The route allow-list follows Project A's route guard `[S5]`: built from Better Auth's own endpoint inventory, matched with the same `better-call` router Better Auth uses, so our matching cannot disagree with the provider's. `better-call` is declared directly at the exact version Better Auth depends on, with a test that the two versions match. Better Auth does not re-export the router, so there is no way to do this through `better-auth` alone.
- App-owned routes under `/api/app-auth/*`, starting with `GET /api/app-auth/session`, which returns a stable `AppSession` shape from `contracts`.
- An `AuthEmailSender` interface backed by **our own SES v2 sender** instead of `@aws-sdk/client-sesv2` (owner decision, 2026-11-18). All three repos use 1 of the SDK's 116 commands, and the SDK releases about every 1.6 days, which would put an AWS bump in nearly every daily update PR. About 150 lines plus tests: a SigV4 signer on `node:crypto`, the `SendEmail` request, error mapping, a timeout and a retry schedule. Static access keys only; a project that needs role assumption, SSO or instance credentials swaps the SDK back in behind the interface. Verify the signer against AWS's published SigV4 test vectors; the line estimate and signing details came from research, not from running code.
- **SES local is part of the base, not optional** (owner decision, 2026-11-18). It is **our own capture server** of about 120 lines on `node:http`, replacing the `aws-ses-v2-local` package (owner decision, 2026-11-18), which brought 65 to 111 installed packages and the `nodemailer` advisories all three repos had to override. It serves `POST /v2/email/outbound-emails`, `/store`, `/health-check`, `/clear-store` and an inbox page, binds to loopback only, keeps a bounded store, and rejects raw MIME content loudly. `bun dev` starts it alongside Postgres, the server and web. `.env.example` points the server at it by default, so verification and reset emails work on a fresh clone with no AWS account, and its inbox viewer is linked from the README. The live tests and the Playwright journey read emails from its `/store`. Production config must refuse the local endpoint, as Project C's does.
- A short `docs/auth.md` listing the pitfalls Project C's reviews found: read the clock after taking row locks, recheck the session inside transactions, and treat a lost response on a security action as an unknown outcome.
- **Phase 4 outcome (2026-11-19):** done as planned, with the departures and findings recorded in plan 004, section 10. Corrections to this section: the size estimates were low (the SigV4 signer is about 150 lines and the SES client about 210, against "about 150" for both; the capture server about 250, against "about 120", mostly input validation and the inbox page); the signer passes the 38 v4 cases of the AWS SigV4 test suite, which AWS no longer offers as a download from its documentation and now keeps in `awslabs/aws-c-auth`; and Better Auth 1.7.25 differs from what our projects ran in ways that matter here: it turns its origin and CSRF checks off by default when `NODE_ENV` is `test`, accepts a `casing` option without using it, and leaves UUID ids to the database's default on Postgres.

### Phase 5: web blank slate

- `packages/client`: an RPC client with a configurable base URL (fixes defect 6), an injected session store, and session-gated query state that purges cached data when the signed-in user changes. Both Project A and Project C hit stale-session bugs here.
- Screens: sign up, sign in (password or passkey), verify email, reset password, a signed-in home, the profile page with passkey management, and an admin-only user list (D8).
- Route guards as `beforeLoad` (`requireSession`, `redirectSignedIn`) with a safe-redirect check.
- Override TanStack Router's default search parsing so opaque tokens aren't turned into numbers.
- `packages/theme`: one Tailwind 4 token file, with a contrast test.
- `packages/i18n` (owner decision, 2026-11-18: every app will support multiple languages): `i18next` 27.1.5 and `react-i18next` 18.0.2 with typed keys so a mistyped key fails the build, English as the only locale to start. Web, mobile and server emails all read from it. Copy the shape from Project B's i18n package `[S6]`. **Moved to phase 7 (plan 005, section 2):** `eslint-plugin-i18next`, because ESLint itself arrives in phase 7 (D4). Phase 5 still ships no hard-coded user-visible string; phase 7 makes that a gate.
- **Phase 5 outcome (2026-11-19):** done as planned, with the departures recorded in plan 005, section 11. Corrections to this section: `i18next` is 27.1.3, not 27.1.5 (27.1.4 and 27.1.5 were published on 2026-11-17, too young for the 3-day rule on 2026-11-19); TanStack Router 1.171's default search parsing does corrupt raw tokens (`1e5` becomes 100000, `null` becomes null, a 20-digit number is rounded), though its own write-then-read round trip is safe because it quotes such strings; and a real browser ran the whole journey, passkeys included, against the built server with no CSP violation and no header change.

### Phase 6: mobile blank slate

Copy from Project B `[S7]`; it is the only one of our projects with verified native builds.

- `apps/mobile` on Expo ~58.0.25, React Native 0.88.1, expo-router 58.0.32, `expo-dev-client`. Native packages are added only through `bunx expo install`, and Dependabot ignores Expo-pinned modules.
- `app.config.ts` over a tested `buildExpoConfig(env)`, with `APP_VARIANT` (development, preview, production) setting bundle id, URL scheme and name. The server reads the same variant table for trusted origins.
- `EXPO_PUBLIC_API_BASE_URL`, validated as a bare origin with HTTPS required outside development.
- Auth client using `expoClient` with SecureStore and a storage prefix scoped to the API origin.
- The same screens as web, using `packages/client`, `contracts` and `theme` through Uniwind (D7). Passkey sign-in on mobile is an open item: no repo of ours has a verified native flow, so the first version signs in with email and password and the phase investigates native passkey support before promising it.
- `eas.json` with development, preview and production profiles.
- Tests under Vitest with jsdom and `react-native-web`, so coverage merges into the root report. Metro block-lists test files.
- `docs/mobile-dev.md`: simulator and device setup, pointing a phone at a local server, and a playbook for testing on a physical phone over a private network `[S7]`.
- **Monorepo linking:** start with bun's default linker, as Project B does on bun 1.4.4. Project A needed `linker = "hoisted"` on bun 1.3.9. **This phase is not done until someone boots the app on a simulator from a fresh clone on a Mac**, because that has not been verified for a clean checkout in any report.
- **Phase 6 outcome (2026-11-19): implemented, first boot on a Mac pending** (`docs/mobile-first-boot.md`). Done as planned on Linux, with the departures recorded in plan 006, section 12. What was proven: from a fresh clone under bun's default linker, Metro bundles both platforms with one React and the workspace packages from source, `expo prebuild` generates both native projects with each variant's identity, and Expo's autolinking resolves each native module once; nothing needed `linker = "hoisted"`. What was not: no simulator or device ran the app, and `pod install` and the native builds were not run. Corrections to this section: expo-router is 58.0.31, not 58.0.32 (published 2026-11-17, too young for the 3-day rule), and so are `expo` 58.0.25, `expo-dev-client` 58.0.20 and `expo-web-browser` 58.0.8, one patch behind Expo's newest map until 2026-11-20; `expo install` asks Expo's servers for those newest patches unless run with `EXPO_OFFLINE=1`. Mobile passkeys were investigated and not shipped (`docs/mobile-dev.md`).

### Phase 7: quality gates

- One `agent:check` script that runs everything CI runs.
- Root Vitest config with `test.projects` and one merged coverage report (100% threshold, D5).
- oxlint with a real config and no-suppression check; type-checked ESLint with sonarjs (D4); knip; dependency-cruiser rules that keep clients to `contracts`, `shared`, `client`, `theme` and `i18n`.
- `eslint-plugin-i18next`'s `no-literal-string` rule, moved here from phase 5 (plan 005, section 2): no hard-coded user-visible string in a component.
- One Playwright journey (sign up, verify, sign in, sign out) with an axe check, at 1.65.1.
- `bun audit` step with a triage file, and the `deepmerge` patch and overrides Project B needed `[S2]`, if they still apply.
- **Phase 7 outcome (2026-11-19):** done as planned, with the departures and the verification recorded in plan 007, section 11. Corrections to this section: there are two Playwright journeys, not one (the passkey journey deferred by plans 004 and 005 is the second); `@playwright/test` is 1.65.1 and `@axe-core/playwright` 4.14.0. None of the `deepmerge` patch and the overrides `[S2]` applies here: `deepmerge`, `nodemailer`, `glob`, `uuid` and `unzipper` are not in the lockfile, `zod` has one copy with no advisory, and `node-forge` 1.4.3 has none; the only override is phase 6's `minimatch`, which `eslint-plugin-sonarjs` 4.2.2 now needs too. vitest stays on 5.1.0, since 5.1.1's coverage fix does not apply to these projects. `eslint-plugin-sonarjs` 4.2.2 also caps TypeScript below 6.1, a second reason for D6. To re-check on the day (section above): knip 6.46.x was still too young (6.45.1 used), dependency-cruiser 18.8.0 became eligible the same day and is used, and typescript-eslint 8.73.0 is used.

### Phase 8: deployment kit

- A multi-stage, digest-pinned `Dockerfile` (from Project C `[S8]`) that runs the bundled server, with `migrate` as a separate mode and a separate database role.
- `.dockerignore`, and a CI step that builds the image and smoke-tests it.
- `docs/deployment.md`: env matrix, migrations, health checks, proxy headers. Hosting-neutral, since the existing projects do not share a host.
- No infrastructure code in the base. Projects that need it use Terraform (D10). The Alchemy evaluation is in the companion `[S10]`.
- **Phase 8 outcome (2026-11-20):** done as planned, with the departures recorded in plan 008, section 9. Corrections to this plan and to plan 008: Better Auth 1.7.25 does not check the schema at startup but on the first auth request, and keeps a mismatch until the process restarts, so a server started on an unmigrated database came up and reported ready; the server now refuses to start when any migration in its build has not been applied. A production install of this workspace under bun's default linker holds 628 packages; the image copies only the server's 63 run-time packages out of it, in bun's own layout. The image is 394 MB on disk (91 MB compressed).

### Phase 9: conventions and docs

- `AGENTS.md` with `CLAUDE.md` importing it: commands, gates, layering rules, the dependency rule (prefer a platform API or a package we already keep; a new dependency needs a stated reason; no git-hook manager, use `core.hooksPath`; run TypeScript scripts with bun), the no-AI-attribution commit rule (enforced in CI).
- `plans/` with a numbered index so plan numbers are never reused, and an ADR folder.
- Project notes for the `implement-plan` skill.
- `CHANGELOG.md` recording each scaffold-level change, starting with this rework (D9).
- A new README, and a rename script replacing the manual checklist: package scope, env var prefix, cookie prefix, URL schemes, bundle ids, page title.

- **Phase 9 outcome (2026-11-20):** done as planned, with the departures recorded in plan 009, section 10. `AGENTS.md` (imported by `CLAUDE.md`) and project notes for implementing plans; a commit-attribution gate in `agent:check` and CI, with an optional `commit-msg` hook; `plans/README.md` and ten decision records in `docs/adr/`, with a test on both indexes; `bun run rename`, proved by a fifth CI job that renames a copy and runs the install, `agent:check`, the build and the mobile export in it; a new README, `docs/new-project.md` and `docs/README.md`; the changelog organised by area; and the stale docs corrected, with a test on the docs' commands, links and paths. Corrections to this section: the rename covers far more than the six names listed (the slug alone names the root package, the Expo slug and dev client scheme, the image, the compose project, the database, the client-IP header and the Effect service keys); there were no `S10N_BASE_*` env vars left to rename, phase 3 having removed the last.

### Phase 10: backport plans for existing projects

Per D9, one short plan per existing project, written into that project's own private repo once the base phases have landed, listing which base changes are worth porting and in what order. The per-project lists, including the dependency decisions already made for each, are in the companion `[S11]`. They are not reproduced here because they describe private code.

Common to all of them:

- bun `minimumReleaseAge`, the package targets from phase 2, and anything in the base changelog they lack.
- The Effect core lifecycle and config pattern, if it proves out in the base.
- Our own SES sender and capture server in place of the two AWS-related packages.
- `kysely-codegen` as the standard for database types.
- `i18next` through a shared i18n package.

### Later, as optional recipes

Not in the default template; documented so a project can add them the same way each time.

- Background worker with a Postgres outbox.
- Realtime across instances with Postgres `LISTEN/NOTIFY`, replacing the removed WebSocket hub.
- Organizations and social sign-in (Apple, Google).
- A marketing site in Astro, a security-gates workflow with Semgrep, product analytics, and mobile end-to-end tests.

## 7. Deliberately left out

- Product-specific features from the existing projects: billing, tenancy and organisation models, multi-factor and device-trust flows, invitation models and native on-device features.
- T3 Code's pairing and single-owner auth model, and its Electron bridge.
- Drizzle, which the upstream review suggested; all three of our projects use Kysely.
- Alchemy and any other infrastructure code (D10).

## 8. Open risks

- **Little was executed.** Phase 1 ran the gates locally and confirmed defect 1; phase 2's CI smoke test is the first evidence that the built server starts.
- **s10n-base is public and the three spin-offs are private.** The scrub check before phase 1 is the control; a missed term in a pushed commit is public and stays in history.
- **Fresh-clone Expo build under bun's default linker:** the Metro bundles and generated native projects are verified on Linux (phase 6); `pod install`, the native build and a boot on a simulator are not, until the owner's first boot on a Mac.
- **Better Auth 1.7.25, jsdom 31 and vitest 5.1.1** are newer than anything our repos run.
- **React pinned at 19.3.0** means holding back a patch on web until Expo moves.
- **Effect core adoption (D1)** has not been tried in any of our repos.
- **Passkeys on mobile** have no verified pattern in our repos. Phase 6 found what a native flow needs (a native passkey module, associated domains and the server's association files, Android's key-hash origins, an https domain for development) and shipped none of it.
