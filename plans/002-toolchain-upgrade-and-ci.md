# 002: Toolchain and package upgrade, minimal CI, daily dependency updates

> Status: implemented on 2026-11-19, on branch `feature/001-strip-desktop-and-local-first` (PR #1, which carries the whole rework).

Phase 2 of [000](000-hosted-starter-rework.md). Builds on [001](001-strip-desktop-and-local-first.md). Source labels such as `[S3]` are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

1. Every package and tool on the newest stable release that is at least 3 days old, with the rule enforced by the package manager.
2. The built server starts (defect 1), and a CI workflow proves it on every push.
3. A scheduled workflow that opens one pull request a day with everything the rule allows.

## 2. Out of scope

| Not in this phase | Owner |
|---|---|
| Server behaviour: config validation, CORS, shutdown, Postgres, the `dev`/`start` runtime mismatch | Phase 3 |
| ESLint, knip, dependency-cruiser, the coverage threshold, `agent:check`, `bun audit` as a gate, Playwright | Phase 7 |
| Dockerfile and its Dependabot entry | Phase 8 |
| README rewrite, `AGENTS.md`, the CI check on commit attribution | Phase 9 |
| New runtime dependencies. Dev tooling named below is the only addition. | |

Decisions D4 and D6 of plan 000 are fixed: bun, turbo and TypeScript `~6.0.3` stay.

## 3. Check before relying on it

Plan 000's version table is registry data from 2026-11-18 and its notes on tool behaviour come from reading, apart from two small bun tests. Before building on a claim below, confirm it by running it, and record what you saw in section 10. In particular:

- `minimumReleaseAge` in `bunfig.toml` is honoured by `bun install`, `bun update` and `bun update --latest`, and the name of the per-package exclusion setting (plan 000 knows only the CLI flag `--minimum-release-age-excludes`).
- Whether `bun update --latest` can be limited to named packages and still rewrites the root `catalog`.
- The exact output format of `bun outdated`, including the marker for versions held back by the age gate.
- `oven-sh/setup-bun` can read the bun version from `package.json` (`packageManager`), and the option name.
- Dependabot's cooldown option name and shape.
- Every action SHA you pin: resolve the tag to a commit yourself with `gh api`; do not copy SHAs from anywhere else.

## 4. Version sources

Each version lives in one place, so the daily job never edits a workflow file.

- **Node:** `.nvmrc` holds the exact version: the newest release on the current LTS line that is at least 3 days old today (26.13.1 on 2026-11-18). `engines.node` is `>=` that same version. `@types/node` is on the same major.
- **bun:** `packageManager` in the root `package.json` holds the exact version (1.4.4 unless a newer stable release is at least 3 days old today). `engines.bun` is `>=` that version.
- CI reads both through `node-version-file` and `bun-version-file`.
- A test (`scripts/version-sources.test.ts`) fails if `.nvmrc`, `engines.node`, `engines.bun`, `packageManager` and the `@types/node` major disagree.
- If the local Node is older than the new `.nvmrc`, install the right one with whatever version manager the machine has; if there is none, say so in section 10 and rely on CI for the Node-specific evidence.

## 5. The upgrade

### 5.1 The 3-day rule in the package manager

- New `bunfig.toml`: `[install] minimumReleaseAge = 259200`, with a comment giving the rule in one line.
- Patch exceptions go in the same file through the exclusion setting found in section 3, each with a comment naming the bug it fixes and the date it can be removed. Plan 000 lists two that may still be needed today: `vitest` with `@vitest/coverage-v8` (5.1.1) and `turbo` (2.11.13). If a release has passed 3 days by the time you run this, it needs no exception.

### 5.2 Targets

Use plan 000's phase 2 table as the starting point and let the age gate decide the final numbers: for each entry take the newest stable version the gate allows today. Where today's answer differs from the table, the gate wins, except:

- `typescript`: `~6.0.3` (D6; typescript-eslint caps below 6.1). Check whether typescript-eslint 8.73.0 or later changes that cap and record the answer; do not act on it.
- `react`, `react-dom`: exactly `19.3.0`; `@types/react`, `@types/react-dom`: `~19.3.0`. Expo SDK 58 pins 19.3.0.
- `effect`: exact, with the root `overrides.effect` kept.
- `vitest` and `@vitest/coverage-v8`: exact and equal. Add `@vitest/coverage-v8` now so the pair moves together; the threshold comes in phase 7.
- `oxlint` and `oxfmt`: exact.
- `jsdom`: 31.x. Fall back to 30.1.3 only if a test fails for a reason inside jsdom, and record the failure.
- Add `@testing-library/dom` (`^10`): `@testing-library/jest-dom` 7 needs it as a peer.

Move `oxlint` and `oxfmt` into the catalog with the rest. Record the final table (package, from, to, publish date of the target) in section 10, generated from the registry, not typed by hand.

### 5.3 What the upgrade is expected to break

From the audit `[S3]`. Each is a prediction; fix what actually breaks and note anything that did not happen or was not predicted.

- **tsdown 0.23:** add `deps: { alwaysBundle: [/^@s10n-base\//] }` to `apps/server/tsdown.config.ts`, and drop `dts: true` (the entry is a program, not a library). This is the fix for defect 1: reproduce the failure first (plan 001 section 8 has the exact error), then confirm `node apps/server/dist/bin.mjs` starts and answers `/health`.
- **vitest 5:** delete `vitest.workspace.ts`; add a root `vitest.config.ts` with `test.projects` covering `apps/*`, `packages/*` and `scripts`. Mocks are now cleared before each test and un-awaited async assertions fail.
- **`packages/shared` has no tests.** Add them (`id`, `json`, `time`) and remove `passWithNoTests`.
- **jsdom 31 with TanStack Router:** a `window.scrollTo` stub in the web test setup removes the "Not implemented" noise.
- **TypeScript 6.0:** zero deprecation warnings, without `ignoreDeprecations`. Fix `tsconfig.base.json` instead.
- **Effect beta to stable:** the source uses only `Schema`, `Option` and `Effect` from `"effect"`; fix whatever the stable API changed.
- **vite 8 and plugin-react 6:** no config change expected.
- **oxfmt 0.x:** a repo-wide reformat. Do it as its own commit containing nothing else. `plans/` stays excluded (`.oxfmtrc.json`).
- **oxlint:** new rules may fire. Fix the code; do not disable a rule.

After the upgrade, run `bun audit` and record its output in section 10. It is not a gate yet. Confirm the advisory list in plan 000 defect 7 is cleared, including the `ws` copy that `jsdom` pulls in.

### 5.4 Order

Version sources and `bunfig.toml`; toolchain (bun, Node, TypeScript, turbo); build and test stack (tsdown with the defect 1 fix, vite, vitest, jsdom, testing-library); runtime libraries (effect, React, TanStack, Tailwind); lint and format tools, then the reformat commit. Keep the gates passing at each commit.

## 6. CI

`.github/workflows/ci.yml`:

- Triggers: `pull_request`, and `push` to `main`.
- `permissions: contents: read`; a concurrency group per ref that cancels superseded runs; a job timeout; `ubuntu-24.04`.
- Every action pinned to a full commit SHA with the version in a trailing comment; `persist-credentials: false` on checkout.
- Steps: checkout, Node from `.nvmrc`, bun from `package.json`, `bun install --frozen-lockfile`, `bun run fmt:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, then the smoke test.
- Smoke test: `scripts/smoke-built-server.ts`, run with bun. It starts `node apps/server/dist/bin.mjs` on a free port, polls `/health` until it answers or a deadline passes, checks the body, stops the process, and exits non-zero with the server's output on failure. Add it as `bun run smoke`. Before the tsdown fix is in, run it once and confirm it fails for defect 1; that is the evidence the step catches what it is for.

Root `typecheck` must also cover `scripts/` (a `scripts/tsconfig.json`), and root `test` must run the scripts' tests.

`.github/dependabot.yml`: the `github-actions` ecosystem only, weekly, grouped, with a 3-day cooldown. Add a comment that bun packages are handled by the daily workflow because Dependabot cannot update a bun `catalog`, and that Docker entries are added by the phases that add Docker files (3 and 8).

## 7. Daily dependency-update workflow

The design is fixed in plan 000 ("Daily dependency-update workflow"). This section says how to build it so that almost all of it is tested without GitHub.

### 7.1 Layout

- `.github/workflows/dependency-updates.yml`: thin. Checkout, tool setup, token, then calls the script.
- `scripts/dependency-updates/`: TypeScript run with bun. Pure logic in small modules with unit tests; one entry file (`run.ts`) that does the I/O (`git`, `gh`, `bun`, `fetch`) through an injected interface so the flow is tested with fakes.
- `dependency-holds.json` at the repo root: the hold list.

### 7.2 Hold list

One entry per package or group: `packages` (names or a pattern such as `expo-*`), `reason`, and optionally `range` or `group`. Entries, per plan 000:

- `react`, `react-dom`, `react-native` and Expo-managed native modules: owned by the Expo SDK.
- `typescript`: below 6.1.
- `better-auth`, `@better-auth/expo`, `@better-auth/passkey`, `better-call`: one group, moved together only.
- `kysely`: 0.29.x.

Several of these packages are not installed until later phases; the entries exist now so they apply the day the package arrives. `scripts/dependency-updates/holds.test.ts` enforces: every entry has a reason; every held package present in the catalog satisfies its `range`; every member of a group present in the catalog has the same version as the others.

### 7.3 Behaviour

- **Update:** everything in the catalog and workspace manifests except held packages, to the newest version the age gate allows, crossing majors, exact pins staying exact. Use whichever mechanism section 3 showed to work (named packages, or a full `bun update -r --latest` followed by restoring held entries and reinstalling). Install with `--ignore-scripts`.
- **bun:** newest stable release at least 3 days old from the `oven-sh/bun` GitHub releases; write `packageManager` and `engines.bun`.
- **Node:** newest release at least 3 days old on the current LTS line from `https://nodejs.org/dist/index.json`; write `.nvmrc` and `engines.node`. A new LTS major is reported, not applied. `@types/node` stays on Node's major.
- **Expo:** if `apps/mobile` exists, run `bunx expo install --check` there and report drift. It does not exist yet; the script says so in its output and phase 6 revisits this.
- **Supersede, don't pile up:**
  1. Find the open PR labelled `dependency-update`, if any.
  2. Starting point: that PR's head with `main` merged in; if the merge conflicts, or there is no open PR, `main`. Say in the PR body when a conflict forced a fresh start.
  3. Apply the update. If it changes no file on top of the starting point, stop and leave everything as it is.
  4. Otherwise push `deps/update-YYYY-MM-DD` (UTC) and open a PR with the label. If the open PR is already on today's branch, push to it and update its body instead. Otherwise comment on the old PR with a link to the new one, close it and delete its branch.
- **PR body:** changes grouped as major, minor and patch; bun and Node changes; anything reported but not applied (new LTS major, new Expo SDK, Expo drift); and the packages `bun outdated` marks as held back by the age gate, with one line on how to take a patch early.
- **Dry run:** `bun run deps:update --dry-run` does everything locally and prints the PR body and the git and `gh` commands it would have run, without pushing or calling the GitHub API for writes.

### 7.4 Workflow file

- `schedule: cron "0 0 * * *"` and `workflow_dispatch`.
- `permissions: contents: read` for the job. Writes use an installation token from `actions/create-github-app-token` with secrets `DEPS_UPDATE_APP_ID` and `DEPS_UPDATE_APP_PRIVATE_KEY`. The checkout uses that token so the pushed branch triggers CI.
- If the secrets are not set (a new project made from the template, or a fork), the job ends successfully with a notice saying what to configure. It must not fail every night.
- SHA-pinned actions, a concurrency group that does not cancel a running update, a timeout.
- The key never appears in logs: no `set -x`, no echoing of the token.

### 7.5 What cannot be verified in this phase

A scheduled or manually dispatched workflow runs only from the default branch, and the GitHub App does not exist yet. So the workflow file itself will not have run when this phase is reviewed. The evidence is: the unit tests, the flow tests with fakes, a real `--dry-run` on this branch (paste its output into section 10), and the YAML parsing cleanly. Say this plainly in the PR description. The first real run is an owner step after merge.

## 8. Docs

- `docs/dependencies.md`: the 3-day rule and where it is enforced; how to take a bug-fix patch early (the `bunfig.toml` exclusion, with the reason and removal date); the hold list and how to change it; that `better-auth`, `@better-auth/expo`, `@better-auth/passkey` and `better-call` move together; how the daily PR works, including fixing a broken major on the PR's branch; the two secrets and the App permissions (Contents read and write, Pull requests read and write, nothing else); and that GitHub disables scheduled workflows in a public repo after 60 days without activity.
- `README.md`: update the requirements (bun, Node) and the commands list (`smoke`, `deps:update`), and link `docs/dependencies.md`. No rewrite.
- `CHANGELOG.md`: an entry for the upgrade (with the version table's headline moves), CI, the age gate and the daily workflow.
- `plans/000-hosted-starter-rework.md`: status line; mark defects 1, 7 and 9 fixed; correct any claim section 3 disproved.

## 9. Verification and definition of done

On the final commit, recorded in section 10 and in the PR description:

1. From a clean `node_modules`: `bun install --frozen-lockfile`, `bun run fmt:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run smoke`. All pass, with no baseline exceptions this time.
2. `bun run typecheck` prints no TypeScript deprecation warning.
3. The age gate works: show one package where the gate holds back a newer release (`bun outdated` output is enough).
4. `bun run deps:update --dry-run` output.
5. CI is green on the PR's head commit, including the smoke step. This is the first CI run in the repo; if a step behaves differently there than locally, fix the cause.
6. `git grep -n 'vitest.workspace\|passWithNoTests\|ignoreDeprecations'` prints nothing outside `plans/` and `CHANGELOG.md`.
7. The scrub check from plan 000 prints nothing.

Done when all of section 5 to 8 is in, the above passes, and section 10 records the final version table, every claim checked in section 3 with its result, and every departure from this plan with the reason.

## 10. How it was built

Implemented on 2026-11-19 on Node 26.13.1 (installed with nvm; the machine had 26.12.1) and bun 1.4.4. Registry data was read the same day, around 06:30 UTC.

### Claims checked before relying on them (section 3)

All of these were run, in a throwaway bun workspace or in this repo, on bun 1.4.4.

| Claim | Result |
| --- | --- |
| `minimumReleaseAge` in `bunfig.toml` is honoured by `bun install`, `bun update` and `bun update --latest` | **Confirmed**, and by `bun add`. `bun install` resolved `@tanstack/react-query` `^5.90.0` to 5.107.1, not 5.107.2 or 5.108.0 (both published 2026-11-17). `bun update --latest` took `@testing-library/jest-dom` 7.0.1, not 8.0.0 (published that day), and oxlint 1.93.0, not 1.94.0. `bun add turbo` installed 2.11.11, not 2.11.13. The gate also applies to indirect dependencies. |
| Name of the per-package exclusion setting | **`minimumReleaseAgeExcludes`** (an array) under `[install]`. Proved by effect: excluding `@tanstack/react-query` made bun pick 5.108.0. Two limits plan 000 did not know: it covers only the packages named (react-query 5.108.0 then failed on `@tanstack/query-core` 5.108.0, `blocked by minimum-release-age`; vitest 5.1.1 needs `@vitest/mocker` and `@vitest/spy` listed too), and for a package with platform binaries as optional dependencies (oxlint) bun skips the blocked binaries **without an error**, leaving a lockfile with no binary at the new version. Listing the platform package by full name works; `@oxlint/*` did not (tried with the CLI flag). The CLI flag `--minimum-release-age-excludes` exists too and replaces the `bunfig.toml` list. |
| `bun update --latest` can be limited to named packages and still rewrites the catalog | **No.** `bun update --latest effect`, `bun update --latest oxlint`, the same with `-r`, and the negated forms `'!typescript'` (with and without `-r`) all reported "no changes" and left the catalog alone; from a workspace directory, `bun update --latest effect` failed with "not a dependency of this workspace". Only an unfiltered `bun update -r --latest` (or without `-r`) rewrites the catalog: it crossed majors (typescript `~6.0.2` to `~7.0.2`, jest-dom `^6.9.1` to `^7.0.1`), kept exact pins exact (effect `4.0.3` to `4.1.4`) and kept `~` as `~`. So the daily script updates everything, restores held packages and reinstalls. |
| Output format of `bun outdated` | A table: `Package` (with ` (dev)` for dev dependencies), `Current`, `Update`, `Latest`, `Workspace` (`catalog (<workspace names>)`), separated by `\|`, ending with the note "The * indicates that version isn't true latest due to minimum release age". The `*` follows the version in `Update` or `Latest`. A row can show `Current` equal to `Latest` with a `*`, which means only a release younger than 3 days is newer (react-query 5.107.1). Held packages show without a `*` (react 19.3.1, typescript 7.0.2). Exit code 0. `scripts/dependency-updates/outdated.test.ts` uses captured output. |
| `oven-sh/setup-bun` reads the bun version from `packageManager` | **Confirmed.** Option `bun-version-file: package.json`; v2.2.0's source reads `pkg.packageManager?.split("bun@")?.[1] ?? pkg.engines?.bun`, and the first CI run logged downloading `bun-v1.4.4`. `setup-node` with `node-version-file: .nvmrc` logged "Resolved .nvmrc as 26.13.1". |
| Dependabot's cooldown option | `cooldown:` with `default-days` (and optional `semver-major-days`, `semver-minor-days`, `semver-patch-days`, `include`, `exclude`), from GitHub's Dependabot options reference. It applies to version updates, not security updates. The same page says recent Dependabot applies a 3-day default cooldown even when none is set; the file sets it anyway. |
| Action SHAs | Resolved with `gh api repos/<repo>/git/ref/tags/<tag>` (dereferencing annotated tags) and cross-checked with `gh api repos/<repo>/commits/<tag>`: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, `oven-sh/setup-bun` v2.2.0 `0c5077e51419868618aeaa5fe8019c62421857d6`, `actions/create-github-app-token` v3.3.0 `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`. The newest token action, v3.4.0, was a day old, so v3.3.0 follows the 3-day rule. |

Also checked: typescript-eslint 8.73.0 (published 2026-11-16 17:07 UTC, so not eligible until the evening of 2026-11-19) still peers `typescript >=4.8.4 <6.1.0`, as does `@typescript-eslint/parser` 8.73.0. The cap stands; nothing was changed for it.

### Final versions

Generated from the lockfiles before and after this phase and the npm registry's publish times. "From" is the catalog spec and the version the old lockfile resolved.

| Package | From (spec, locked) | To (spec, locked) | Published |
| --- | --- | --- | --- |
| @tailwindcss/vite | `^4.1.15`, 4.2.2 | `^4.3.5`, 4.3.5 | 2026-11-06 |
| @tanstack/react-query | `^5.90.5`, 5.99.0 | `^5.107.1`, 5.107.1 | 2026-11-06 |
| @tanstack/react-router | `^1.133.22`, 1.168.22 | `^1.170.46`, 1.170.46 | 2026-10-22 |
| @testing-library/dom | new | `^10.4.2`, 10.4.2 | 2026-09-13 |
| @testing-library/jest-dom | `^6.9.1`, 6.9.1 | `^7.0.1`, 7.0.1 | 2026-08-09 |
| @testing-library/react | `^16.3.0`, 16.3.2 | `^16.3.3`, 16.3.3 | 2026-08-27 |
| @types/node | `^24.10.0`, 24.12.2 | `^26.6.6`, 26.6.6 | 2026-10-28 |
| @types/react | `^19.2.2`, 19.2.14 | `~19.3.0`, 19.3.0 | 2026-09-09 |
| @types/react-dom | `^19.2.2`, 19.2.3 | `~19.3.0`, 19.3.0 | 2026-09-09 |
| @vitejs/plugin-react | `^5.1.0`, 5.2.0 | `^6.3.0`, 6.3.0 | 2026-11-09 |
| @vitest/coverage-v8 | new | `5.1.0`, 5.1.0 | 2026-11-02 |
| effect | `4.0.0-beta.45`, 4.0.0-beta.45 | `4.1.4`, 4.1.4 | 2026-11-11 |
| jsdom | `^26.1.0`, 26.1.0 | `^31.0.1`, 31.0.1 | 2026-11-13 |
| oxfmt | `^0.40.0`, 0.40.0 | `0.78.0`, 0.78.0 | 2026-11-09 |
| oxlint | `^1.55.0`, 1.60.0 | `1.93.0`, 1.93.0 | 2026-11-09 |
| react | `^19.2.0`, 19.2.5 | `19.3.0`, 19.3.0 | 2026-09-09 |
| react-dom | `^19.2.0`, 19.2.5 | `19.3.0`, 19.3.0 | 2026-09-09 |
| tailwindcss | `^4.1.15`, 4.2.2 | `^4.3.5`, 4.3.5 | 2026-11-06 |
| tsdown | `^0.20.3`, 0.20.3 | `^0.23.7`, 0.23.7 | 2026-11-06 |
| turbo | `^2.5.8`, 2.9.6 | `^2.11.11`, 2.11.11 | 2026-11-11 |
| typescript | `^5.9.3`, 5.9.3 | `~6.0.3`, 6.0.3 | 2026-04-16 |
| vite | `^7.1.10`, 7.3.2 | `^8.3.8`, 8.3.8 | 2026-11-11 |
| vitest | `^4.0.3`, 4.1.4 | `5.1.0`, 5.1.0 | 2026-11-02 |
| bun | `packageManager` `bun@1.3.9`, `engines` `>=1.3.0` | `bun@1.4.4`, `engines` `>=1.4.4` | 2026-10-22 |
| Node | `engines` `>=24` | `.nvmrc` 26.13.1, `engines` `>=26.13.1` | 2026-11-10 |

Where this differs from plan 000's table:

- **turbo 2.11.11, not 2.11.13; vitest and `@vitest/coverage-v8` 5.1.0, not 5.1.1.** No patch exception was taken. turbo 2.11.12 and 2.11.13 fix affected-task detection, watch mode, `turbo trace` and root dependency scoping, none of which this repo uses, and 2.11.12 also adds features. vitest 5.1.1 fixes real bugs, including coverage attribution for untested files across projects, but coverage is not on until phase 7. Taking either early would also have needed every dependency and platform binary listed in the exclusion (see above). Both become eligible on 2026-11-21 and the daily update takes them then.
- **`@testing-library/jest-dom` 7.0.1** as planned; 8.0.0, a new major, was published at 03:09 UTC on 2026-11-19 and becomes eligible on 2026-11-22.
- **oxlint 1.93.0 and oxfmt 0.78.0** as planned; 1.94.0 and 0.79.0 turn 3 days old at about 12:27 UTC on 2026-11-19, after this work.
- **`@testing-library/dom` 10.4.2** is new, as section 5.2 asked.

### What the upgrade actually broke

- **tsdown 0.23 (defect 1):** reproduced first. With the smoke script in place, `bun run smoke` failed on tsdown 0.20.3 and again on 0.23.7 with the old config, both times with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>/packages/contracts/src/base' imported from <repo>/packages/contracts/src/index.ts`, the server exiting with code 1. With `deps: { alwaysBundle: [/^@s10n-base\//] }` the bundle's only imports are `node:http`, `node:path`, `node:fs` and `effect`, and the smoke test passes. Dropping `dts: true` was not enough: tsdown still wrote `bin.d.mts`, because `composite: true` in the server's tsconfig implies `declaration` and tsdown 0.22+ turns `dts` on from it. The config now says `dts: false`.
- **vitest 5:** `vitest.workspace.ts` deleted, root `vitest.config.ts` with `test.projects` added, and `name` set in each project. No test needed a change for cleared mocks or un-awaited assertions.
- **jsdom 31 with TanStack Router:** the "Not implemented: Window's scrollTo() method" lines appeared twice per run; the stub in `apps/web/src/test/setup.ts` removed them. No test failed, so there was no fallback to jsdom 30.
- **TypeScript 6.0:** no deprecation warning and no tsconfig change.
- **effect beta to 4.1.4:** no source change.
- **vite 8 and plugin-react 6:** no config change.
- **oxfmt 0.78:** **no reformat**, contrary to the prediction; it found nothing to change, so there is no reformat commit. It does check YAML, so the workflow files are formatted by it.
- **oxlint 1.93:** no new finding.
- **Not predicted:** Tailwind's Vite plugin 4.1 does not accept Vite 8 as a peer, so Tailwind moved in the build-stack commit rather than with the runtime libraries.

### `bun audit`

After the upgrade, `bun audit` reported one advisory: GHSA-68fv-2mgg-jv7q (high, `source-map-js` before 1.2.2), reached through `@tailwindcss/node` and `magicast`, because the old lockfile still resolved 1.2.1 for them. `bun audit fix` moved it to 1.2.2 inside their ranges. After that, and on the final commit: `No vulnerabilities found (checked 242 packages)`.

Plan 000's defect 7 list is cleared: `ws` is no longer in the lockfile at all (jsdom 31 does not depend on it), vite is 8.3.8, vitest 5.1.0, turbo 2.11.11, effect 4.1.4, and electron went in phase 1.

### Departures from this plan, with reasons

- **No patch exceptions** (see "Final versions"). `bunfig.toml` has no `minimumReleaseAgeExcludes`; `docs/dependencies.md` documents how to add one.
- **Two lockfile commits the plan did not list.** Besides the `source-map-js` fix, `bun update -r` refreshed eleven indirect dependencies that the old lockfile had kept (for example `@babel/runtime` 7.29.2 to 7.29.14); otherwise the first daily PR would have carried only these.
- **Secret name `DEPS_UPDATE_APP_CLIENT_ID`** instead of `DEPS_UPDATE_APP_ID`. `actions/create-github-app-token` v3.3.0 marks `app-id` deprecated in favour of `client-id`, so the secret holds the app's Client ID. The private key secret keeps its name.
- **`better-call` is not in the better-auth group.** The group test requires one version for all members, and better-call is numbered separately (1.4.5 against 1.7.25). It has its own entry with no range, so the job never moves it, and the docs say to move it by hand with the group. Phase 4 adds the test that it equals better-auth's dependency.
- **More hold entries than section 7.2 listed:** `react-native-*`, `expo`, `@expo/*` with the Expo-owned set, and `@types/react` and `@types/react-dom` held to `~19.3.0`, since they must follow React.
- **The dry run uses a temporary git worktree**, so it can run the whole git flow, including the merge, without touching the caller's checkout. It runs reads (`gh pr list`, `git fetch`) and logs the writes (push, label, PR create, edit, comment, close). It has a `--from <ref>` option, because the default starting point, `origin/main`, does not contain this phase's files yet.
- **The root `test` script is `vitest run`** (the root config with projects) rather than `turbo run test`; the per-package `test` scripts remain for filtered runs. Root `typecheck` is `turbo run typecheck && tsc -p scripts`, and `scripts/tsconfig.json` also covers the root `vitest.config.ts`.
- **The PR body lists indirect dependency moves**, folded. The first real dry run (before the lockfile refresh) would have opened a PR whose body said nothing changed.
- **The update commit's author** is the app's bot user (`<slug>[bot]` with its noreply address), looked up in the workflow from the token action's `app-slug` output.

### Dry run (section 7.5)

Run on this branch with `bun run deps:update --dry-run --from HEAD` at commit 7178b1d: it found the open-PR list empty, ran `bun update -r --latest`, restored react, react-dom and typescript, reinstalled, found no changed file, and stopped:

```
$ gh pr list --label dependency-update --state open --json number,headRefName,url
No open dependency-update PR.
$ git fetch --no-tags origin main
$ git checkout --detach HEAD
$ bun update -r --latest --ignore-scripts
$ bun install --ignore-scripts
apps/mobile does not exist, so there is no Expo version check.
$ bun outdated -r
$ git status --porcelain
Nothing to update: no file changed on top of the starting point.
Dry run: no update PR needed.
```

To see a PR body, the same command with `--from c797d44` (the commit before the indirect-dependency refresh) produced the writes and body below (trimmed to the headings and first rows):

```
Would run: git push --force origin HEAD:refs/heads/deps/update-2026-11-19
Would run: gh label create dependency-update --color 0366d6 --description Opened by the daily dependency-update workflow --force
Would run: gh pr create --base main --head deps/update-2026-11-19 --title Dependency updates 2026-11-19 --label dependency-update --body-file -
PR body:
Dependency update for 2026-11-19, opened by the daily dependency-update workflow. ...
No direct dependency changed.
## Indirect dependencies
<summary>11 indirect dependencies moved in bun.lock</summary>
| @adobe/css-tools | 4.4.4 | 4.5.0 |  ... | use-sync-external-store | 1.6.0 | 1.7.0 |
## Reported, not applied
- react stays at 19.3.0 (newest allowed: 19.3.1): Owned by the Expo SDK. ...
- react-dom stays at 19.3.0 (newest allowed: 19.3.1): ...
- typescript stays at ~6.0.3 (newest allowed: 7.0.2): typescript-eslint supports TypeScript below 6.1 only ...
## Held back by the 3-day rule
| @tanstack/react-query | 5.107.1 | 5.108.0 | 2026-11-17 |
| @testing-library/jest-dom | 7.0.1 | 8.0.0 | 2026-11-19 |
| @vitest/coverage-v8 | 5.1.0 | 5.1.1 | 2026-11-18 |
| oxfmt | 0.78.0 | 0.79.0 | 2026-11-16 |
| oxlint | 1.93.0 | 1.94.0 | 2026-11-16 |
| turbo | 2.11.11 | 2.11.13 | 2026-11-18 |
| vitest | 5.1.0 | 5.1.1 | 2026-11-18 |
```

The workflow file itself has not run: a scheduled or dispatched workflow runs only from the default branch, and the GitHub App does not exist yet. Both workflow files parse (Bun's YAML parser and PyYAML), and `actionlint` 1.7.12 with shellcheck reports nothing on them. The first real run is an owner step after merge.

### Verification on the final commit (section 9)

1. After `bun run clean` (no `node_modules`), on Node 26.13.1 and bun 1.4.4: `bun install --frozen-lockfile` passes (lockfile unchanged); `fmt:check`, `lint` (0 findings), `typecheck` (4 packages and `scripts`), `test` (19 files, 126 tests: contracts, server, web, shared and scripts), `build` (4 packages) and `smoke` all pass, with no baseline exceptions.
2. `bun run typecheck` prints no deprecation warning.
3. The age gate holds packages back; from `bun outdated -r`:

   ```
   | @tanstack/react-query     | 5.107.1 | 5.107.1 * | 5.107.1 * | catalog (@s10n-base/web) |
   | turbo (dev)               | 2.11.11 | 2.11.11 * | 2.11.11 * | catalog (app-scaffold)   |
   | vitest (dev)              | 5.1.0   | 5.1.0     | 5.1.0 *   | catalog (app-scaffold, ...) |
   | typescript (dev)          | 6.0.3   | 6.0.3     | 7.0.2     | catalog (app-scaffold, ...) |
   Note: The * indicates that version isn't true latest due to minimum release age
   ```

   (`app-scaffold` is the root workspace's name as recorded in `bun.lock` since the first commit; `bun install` does not rewrite it.)
4. The dry run is above.
5. CI: the first run in the repo passed every step on 8e2e210, including the smoke step; the result on the PR's head is in the PR description.
6. `git grep -n 'vitest.workspace\|passWithNoTests\|ignoreDeprecations'` prints nothing outside `plans/` and `CHANGELOG.md`.
7. The scrub check prints nothing.

### For later phases

- **Phase 3:** the smoke script sets `HOST`, `PORT` and `S10N_BASE_PORT`; update it when config moves to Effect `Config`. It stops the server with SIGTERM and waits 5 seconds before SIGKILL, so graceful shutdown must finish within that or the smoke run gets slower (it still passes). tsdown bundles only `@s10n-base/*`; `pg` and Kysely will stay external, so the deployed server needs `node_modules` (phase 8). effect 4.1.4 needed no change for `Schema`, `Option` and `Effect`.
- **Phase 4:** move `better-call` with the better-auth group by hand; the holds test enforces one version for the group only.
- **Phase 6:** the update script already runs `bunx expo install --check` in `apps/mobile` when it exists and reports drift; nothing else is automated for Expo. `@testing-library/jest-dom` 8 is out; check it with the web and mobile tests when the daily PR brings it.
- **Phase 7:** oxlint 1.93 exits 0 on warnings, so `--deny-warnings` is needed for lint to be a gate. `@vitest/coverage-v8` is installed but unused; take vitest 5.1.1 (eligible 2026-11-21) before turning on the threshold, since it fixes coverage attribution across projects. `bun audit` is clean today.
- **Phase 8:** add the Docker entry to `.github/dependabot.yml`.
- **Phase 9:** the root workspace name in `bun.lock` is still `app-scaffold`; the rename script should cover it.
