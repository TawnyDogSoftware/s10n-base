# 007: Quality gates

> Status: not started.

Phase 7 of [000](000-hosted-starter-rework.md). Builds on phases 1 to 6. Source labels such as `[S2]` are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

One command, `bun run agent:check`, that runs everything CI runs without a database, and a set of gates strict enough that a project starting from this base inherits them working: lint with no suppressions, type-checked ESLint, dead-code and boundary checks, 100% coverage, a browser journey with an accessibility check, and an audit step.

D4 (oxlint, type-checked ESLint with sonarjs, knip, dependency-cruiser) and D5 (100% coverage on by default, threshold in one place) are fixed.

**The rule for this whole phase: a gate is met by fixing the code or adding the test, never by an exclusion, a suppression or a lowered limit.** Where this plan allows an exclusion, it is listed with a reason in one checked place. If meeting a gate honestly looks unreasonable for some piece of code, stop and report that piece instead of working around it.

## 2. Out of scope

| Not in this phase | Owner |
|---|---|
| Dockerfile, image build in CI | Phase 8 |
| `AGENTS.md`, the commit-attribution check, the rename script, README rewrite | Phase 9 |
| Mobile end-to-end tests on a device; a docstring-coverage gate; a git-hook manager | Recipes or left out |
| New features. Refactors are allowed only where a gate requires them. | |

## 3. Dependencies added (all dev, all through the age gate)

- `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-sonarjs` (D4).
- `eslint-plugin-i18next`: the hard-coded-string rule moved here from phase 5.
- `knip`, `dependency-cruiser` (D4).
- `@playwright/test` (1.65.x) and `@axe-core/playwright`: the browser journey and its accessibility check.

Nothing else. React hook rules and accessibility lint come from oxlint's built-in plugins, not from more ESLint plugins. `typescript-eslint` must keep accepting TypeScript `~6.0.3`; if the newest allowed version does not, hold it and record why.

**vitest:** phase 2 stayed on 5.1.0 because 5.1.1 was too young, and noted that 5.1.1 fixes coverage attribution across projects. First measure coverage on what is installed. If the merged report is wrong in the way that fix describes, take 5.1.1 as a patch exception (every `vitest` and `@vitest/*` package named in `bunfig.toml`, with the bug and a removal date) or, if it has passed 3 days by then, simply update. Record which.

## 4. Lint

- **oxlint, with a real config** (`.oxlintrc.json`): the TypeScript, React (including hook rules), import, jsx-a11y and vitest plugins; `correctness`, `suspicious` and `perf` as errors; `--deny-warnings` in the script, since oxlint exits 0 on warnings otherwise. Ignore only generated output (`dist`, `.expo`, `expo-env.d.ts`, Uniwind's generated types, the generated database types, coverage).
- **No suppressions:** `scripts/check-lint-directives.ts` fails on any `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck`, or a coverage-ignore pragma, anywhere in first-party files. `@ts-expect-error` is allowed only in files whose purpose is a type-level test, matched by name, and the script lists them. ESLint itself runs with inline config disabled.
- **ESLint** (`eslint.config.mjs`, flat config), from Project B's shape in neutral terms (private README, "Phase 7, gates"):
  - `@eslint/js` recommended, `typescript-eslint` strict, and `strictTypeChecked` with the project service on first-party source (`apps/*/src`, `packages/*/src`, `scripts`).
  - `sonarjs` recommended.
  - Size limits: cyclomatic complexity 10, cognitive complexity 15, nesting depth 3, parameters 4, no nested ternary. These will flag existing code; refactor it. If one limit would force a change that makes a function plainly worse, raise that limit by the smallest step, for the whole repo, and record the function that decided it. Never per file.
  - `i18next/no-literal-string` in JSX for `apps/web` and `apps/mobile`, tests excluded. Phases 5 and 6 claim there is nothing to find.
  - The narrow allowances a framework needs (for example a router's thrown redirect) go in the config with a comment, not inline.
- Root scripts: `lint` runs the directive check, oxlint and ESLint.

## 5. Dead code and boundaries

- **knip** (`knip.json`), a normal pass and a production pass: unused files, exports and dependencies fail. Known leftovers to remove: `apps/server`'s unused `@s10n-base/shared` dependency (plan 001), anything orphaned by later phases. Packages used natively or as peers by Expo and never imported are listed in the config with one reason each.
- **dependency-cruiser** (`.dependency-cruiser.cjs`), type-only imports included:
  - no circular dependencies;
  - nothing imports build output;
  - packages never import apps; apps never import each other;
  - `apps/web` and `apps/mobile` import only `contracts`, `shared`, `client`, `theme` and `i18n`;
  - `packages/client` imports only `contracts`, `shared` and `i18n`; `contracts` imports no other workspace package; `shared`, `theme` and `i18n` import none except where already true today (record what is true);
  - `apps/server` imports `contracts`, `shared` and `i18n` only.
  - A test proves each rule can fire, by running the cruiser over small fixture trees that break it.
- Root scripts: `deadcode`, `boundaries`.

## 6. Coverage

- Root `vitest.config.ts`: the v8 provider, one merged report across every project (server, web, mobile, the packages, scripts), and thresholds of 100 for lines, branches, functions and statements, **stated once, here**.
- `include`: `apps/*/src`, `packages/*/src`, `scripts`. `exclude` only:
  - tests and test-only helpers;
  - type declarations and generated files;
  - entry points that only wire things together and are exercised by CI in another way (the server `bin`, the `migrate` and `set-role` entries, the web `main`, the Expo route files that only re-export a screen, config files). Each excluded path is listed with its reason, and what does exercise it.
- `scripts/check-coverage-exclusions.ts` with a test: the config's exclude list must equal a reviewed list in the repo, so adding an exclusion is a visible, deliberate diff. It also fails if an excluded file contains more than wiring by a simple measure you define and document (for example a statement count), so logic cannot hide in an entry point.
- Getting to 100% means writing tests for what phases 1 to 6 left uncovered. Test behaviour, not lines: no test whose only assertion is that a function was called. Where a branch is unreachable, delete it rather than cover it.
- Live-database tests do not count toward this report; `test` must reach 100% with the database stopped. If some server code can only be covered against a real database, say which and why before excluding it.
- Root script: `test:coverage`.

## 7. Browser journey

`e2e/` at the repo root, Playwright with Chromium only, run by `bun run test:e2e`.

- Playwright starts what it needs: the compose database, migrations, the local email capture server, and the **built** server serving the **built** web app, so the real security headers apply.
- **Journey 1** (plan 000): sign up, read the verification email from the capture server's store, verify, sign in, sign out. An axe check on every page visited, failing on serious or critical violations.
- **Journey 2** (deferred here by plans 004 and 005): with a virtual authenticator, add a passkey from the profile page, sign out, sign in with the passkey, remove it.
- Each run uses fresh email addresses. Sign-in rate limits are on in every environment (3 per 10 seconds per address): space the attempts or give each test its own client address through the trusted-proxy setting; do not turn the limiter off.
- No console error and no Content-Security-Policy violation, except the 401 the browser logs for a deliberately wrong password, if a test does that.
- **Failure output must not leak secrets.** Traces, snapshots and videos can contain tokens from email links. Do not upload them as CI artifacts on this public repo; print a text summary of the failure instead. Local traces go to an ignored directory.
- CI: a third job that installs Chromium for the locked Playwright version and runs the journeys.

## 8. Audit

- `scripts/dependency-audit.ts` runs `bun audit` and compares the result with `dependency-audit-triage.json`: each accepted advisory has an id, the package, a reason and an expiry date. It fails on an advisory that is not triaged or whose acceptance has expired, and on a triage entry that no longer matches anything. Root script `deps:audit`; CI runs it.
- Plan 000 lists a `deepmerge` patch and several overrides Project B needed `[S2]`, "if they still apply". Check each against this repo's lockfile and today's advisories. `bun audit` is clean today with one override (`minimatch`, phase 6). Apply only what is actually reachable here, record the answer for each, and correct plan 000.

## 9. `agent:check` and CI

- `bun run agent:check`: directive check, oxlint, ESLint, format check, typecheck, boundaries, dead code, coverage, audit. It needs no database and no browser. It stops at the first failure and says which gate failed.
- CI's first job runs `agent:check` itself, not a copy of its steps, followed by the build, the database steps, the live tests and the smoke test. The mobile job and the new browser job stay separate. A test parses the workflow and fails if the first job stops calling `agent:check`.
- `docs/quality.md`: each gate, how to run it alone, what a failure means and the honest ways to fix it; the no-suppression rule; the coverage exclusion policy; the audit triage file; how to run the browser journeys locally.
- `README.md`, `docs/setup.md`: the new commands. `CHANGELOG.md`: an entry. `plans/000-hosted-starter-rework.md`: status line, and the corrections from sections 3 and 8.

## 10. Verification and definition of done

On the final commit, recorded in section 11 and the PR description:

1. From clean, database stopped: frozen install, then `bun run agent:check` passes.
2. The coverage summary: 100 in all four columns, the number of files measured, and the full exclusion list with reasons.
3. **Each gate can fail.** For every gate (directive check, oxlint, ESLint including the i18n rule and one size limit, format, typecheck, each boundary rule, knip, coverage, the exclusion check, audit triage), introduce one violation, show the gate catching it, and revert. A gate that has never been seen to fail is not verified.
4. `build`, database up, `test:live`, `smoke`, `mobile:export`, `test:e2e`: all pass locally.
5. How many suppressions, exclusions and raised limits exist at the end, each with its reason. The expected answer for suppressions is zero.
6. A short list of the real defects the new gates found in phases 1 to 6, if any, and how each was fixed.
7. CI green on the head commit: all three jobs.
8. The scrub check from plan 000 prints nothing.

Done when sections 3 to 9 are in, the above passes, and section 11 records versions, the vitest decision, the answer for each override in section 8, and every departure with its reason.

## 11. How it was built

Filled in by the implementor.
