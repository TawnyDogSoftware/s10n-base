# 002: Toolchain and package upgrade, minimal CI, daily dependency updates

> Status: not started.

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

Filled in by the implementor.
