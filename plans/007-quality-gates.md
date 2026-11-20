# 007: Quality gates

> Status: implemented on 2026-11-19, on branch `feature/001-strip-desktop-and-local-first` (the rework's single pull request). Section 11 records how.

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

### Versions (section 3)

All dev dependencies, each the newest release the 3-day rule allowed when added: `eslint` 10.15.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.73.0, `eslint-plugin-sonarjs` 4.2.2, `eslint-plugin-i18next` 6.1.5, `knip` 6.45.1, `dependency-cruiser` 18.8.0, `@playwright/test` 1.65.1 (exact, as plan 000 asks) and `@axe-core/playwright` 4.14.0. Nothing else was added. `typescript-eslint` 8.73.0 accepts TypeScript `>=4.8.4 <6.1.0`, so TypeScript stays on ~6.0.3; `eslint-plugin-sonarjs` 4.2.2 also depends on `typescript` `>=5 <6.1.0`, a second reason for D6. knip 6.46.0 and 6.46.1 (2026-11-18) were too young; dependency-cruiser started on 18.7.2 and moved to 18.8.0 once it passed three days, the same day.

**vitest: stayed on 5.1.0.** The merged report was measured first: one v8 report over every project, with each file attributed to its own project's run. vitest 5.1.1's coverage fix concerns projects whose root directory is a string prefix of another's; no two of ours are. No patch exception was taken.

### The overrides and the patch (section 8)

Checked against this lockfile and `bun audit` on 2026-11-19:

| Item from plan 000 | Answer |
|---|---|
| `deepmerge` patch | Not in the lockfile. Not applied. |
| `zod` override | One copy, 4.6.7, through Better Auth and kysely-codegen; no advisory. Not applied. |
| `nodemailer` override | Not in the lockfile: phase 4 replaced the package that brought it with our own capture server. Not applied. |
| `glob`, `uuid` and `unzipper` overrides | None of them is in the lockfile. Not applied. |
| `node-forge` | 1.4.3, through Expo's CLI and code-signing helper (`^1.4.0`); `bun audit` reports nothing for it. No override. |
| `minimatch` `^11.0.8` (phase 6) | Still needed: `@expo/fingerprint` 0.21.10 and now `eslint-plugin-sonarjs` 4.2.2 ask for `^10.2.6`, inside GHSA-g3hv-75wg-m249's range. Kept; its reason in `docs/dependencies.md` names both. |

`bun audit` reports no advisory, so `dependency-audit-triage.json` starts with an empty list.

### Departures and decisions

- **File names.** The plan's `scripts/check-lint-directives.ts`, `scripts/check-coverage-exclusions.ts` and `scripts/dependency-audit.ts` are `scripts/quality/lint-directives.ts`, `coverage-exclusions.ts` and `dependency-audit.ts`, with `agent-check.ts`: the quality scripts in one folder. `knip.json` is `knip.jsonc`, so each exception carries its reason as a comment.
- **Every script entry is a one-line `*.main.ts`.** The coverage exclusion check allows only wiring in an excluded entry point (imports and at most three statements with no branch, loop, try, function or class). The scripts ran their work under `if (import.meta.main)`, which no test can enter, so each became a tested module plus a `*.main.ts` that calls it; `scripts/ses-local/main.ts` became `run.main.ts`. The server's `bin.ts`, `migrate.ts` and `set-role.ts` and the web `main.tsx` were cut down the same way (`nodeRuntime`, `startFromEnvironment`, `mountApp`).
- **No database-dependent exclusion.** Server code that runs queries is unit-tested against `apps/server/src/test/scripted-db.ts`, a Kysely dialect that compiles each query for Postgres and answers from the test. The live tests still prove the SQL. Better Auth 1.7.25 checks the database schema at run time in every environment, so only the unit tests' auth options turn `advanced.database.validateSchema` off.
- **knip.** The production pass runs with `--exclude exports,types`: in it, an export only a test imports would be reported, and that is the normal pass's question. `includeEntryExports` is on, because every package's `exports` map points at its source files, and without it no package API was checked (found while verifying item 3; it removed ten more exports). The live tests' Vitest config is named to knip's Vitest plugin. Exceptions, with reasons in the config: the server's `i18next` (left external by the bundle), the mobile config plugins `expo-dev-client` and `expo-splash-screen`, the generated database types, and the test-only modules the production pass leaves out.
- **Boundaries.** What was true, and is now a rule: `shared` and `theme` import no workspace package, and `i18n` imports none except that its tests read the error codes from `contracts`. Two additions came from verifying item 3: build output stays in the graph (the config had excluded `dist`, which hid every import of it from `no-build-output`), and a `no-unresolvable` rule, since a workspace package the importer does not declare resolves to nothing under bun's linker and slipped past the package rules. The fixture test now runs with the config's own options. `e2e` is cruised too.
- **Allowances in the lint configs** (each with its reason in the config and in `docs/quality.md`): oxlint's `react-in-jsx-scope` off, `no-underscore-dangle` for `_tag` and `__type`, Vitest's message argument, `expectTypeOf` and `waitForLocation` as assertions, side-effect imports of stylesheets and jest-dom, `StatusBar`'s string style, two `jsx-a11y` rules off in `apps/mobile` (React Native's `role`), and `no-await-in-loop` off repo-wide (every loop it found waits on purpose: cursor pagination, one migration at a time, counting rate-limited attempts, polling). ESLint: TanStack Router's `Redirect` for `only-throw-error` in `apps/web`, `sonarjs/no-os-command-from-path` off in scripts, `e2e` and tests (they run git, bun, node and docker from `PATH`), `no-require-imports` off in `.cjs`, `no-undef` off in TypeScript.
- **`lint:eslint` generates Expo's typed routes first.** The i18n rule is type-aware, and without the gitignored `.expo/types` the router's typed `push` looked like a string sink: ESLint passed locally and failed in CI.
- **The directive check** also refuses `eslint-enable`, inline `eslint` config comments and `node:coverage` pragmas. Type-level tests are named `*.types.test.ts(x)`: `packages/contracts/src/rpc.types.test.ts` and `packages/i18n/src/keys.types.test.ts` (renamed from `typed-keys.test.ts`).
- **`agent:check`** also runs `coverage:exclusions`, which section 9's list leaves implicit.
- **The journeys** run on ports of their own (server 4310, capture server 8025) against the compose database's `s10n_base_test`, so a running `bun dev` is left alone, and Playwright starts them itself in CI too, so CI and local runs are the same. Each test sends its own `X-Forwarded-For` through one trusted proxy hop. No journey uses a wrong password, so there is no 401 to allow, and none was seen. A failure leaves Playwright's text page snapshot (`error-context.md`) in the gitignored `e2e/test-results/`; nothing is uploaded.
- **Size limits: none raised.** Every flagged function was split. The larger refactors: the web and mobile auth screens' repeated outcome notice became `ActionOutcome`; the profile pages and the passkey list became smaller components; the production config rules became a table; the HTTP router, SigV4 verification, the SES error classifier, the migrate CLI, the cursor decoder, the shutdown drain, the RPC transport and the fake server's auth routes were split; in the scripts, the hold parser, the semver comparators (a table of operators), the manifest walk, the prebuild check, the capture server's request parser and the smoke test's steps. The bare-origin check, written four times, became `parseBareOrigin` in `packages/shared`.

### Defects the gates found in phases 1 to 6

- The client's email check, and three script regexes, could backtrack super-linearly on long input.
- Seven tests asserted `toThrow()` with no expected error, so they passed on any error.
- The web and mobile resend actions rethrew any failure but a lost answer into an unhandled rejection; they now show `errorMessageKey`'s message.
- The theme parser's error for a missing block printed the regex escape (`@theme \{`).
- ESLint's result depended on gitignored generated files (above).
- The mobile config left over-the-air updates implicitly on although `expo-updates` is not installed; it now says `enabled: false`.
- The session gate used TanStack Query's deprecated `fetchQuery`; it uses `query()`.
- Dead code: 52 exports nothing outside their module used, the web app's unused `effect` dependency, its unused `services.origin` and the re-exported `AuthFailure` type.
- Unreachable branches, deleted rather than covered: fallbacks for regex groups that always match, Node's always-set request method and target, the config's error-provider fallbacks, a second stop in the process runner, a check for a session the layout guarantees, a same-origin re-parse of an already checked path, and the mobile profile's pending check.
- The dependency update script crashed with an uncaught EPIPE when a command exited without reading its input (found on a fresh clone while verifying item 1).
- Template literals that could print `undefined` now say what is missing.
- Found by the coverage gate in CI, where it failed once at 99.96%: the mobile forgot-password, sign-in and sign-up screens switch layout inside one `Screen`, so React reused the form's button for the next layout, and react-native-web gives a reused button its new press handler only in an effect. A press before that effect ran the old handler: the test passed but the new handler never ran. Each layout now has its own key; a test checks the form's button is gone, not reused.
- Found in review, not by a gate (phase 2's dependency update): putting a held package's range spec back after `bun update --latest` left the newer version it had locked inside that range, so the PR said "held" while committing the update. The package is now pinned to its earlier locked version, installed, and given its spec back.

### Verification (section 10)

1. **From clean, database stopped:** a fresh clone of the branch, `bun install --frozen-lockfile`, then `bun run agent:check` with no `s10n-base` container running: all ten gates pass. The first attempt failed in `test:coverage` with the EPIPE above; it was fixed with a regression test, and five further full unit runs were clean.
2. **Coverage:** 100% in all four columns: statements 3676/3676, branches 1978/1978, functions 976/976, lines 3284/3284, over 133 files (131 measured, 2 empty), 1297 tests, on the final commit. Exclusions: the 12 patterns in `scripts/quality/coverage-exclusions.ts`, listed with reasons in `docs/quality.md`: tests (`**/*.test.{ts,tsx}`), test support (`apps/*/src/test/**`, `packages/client/src/test-fetch.ts`, `packages/client/src/testing/**`), type declarations, the generated database types, and six entry points (`apps/mobile/src/app/**`, the server's `bin.ts`, `migrate.ts` and `set-role.ts`, `apps/web/src/main.tsx`, `scripts/**/*.main.ts`).
3. **Each gate can fail.** One violation each, the gate's failure, then a revert:

   | Gate | Violation | What it printed |
   |---|---|---|
   | Directives | `// eslint-disable-next-line` | `packages/shared/src/origin.ts:25:4 eslint-disable-next-line` |
   | Directives | `@ts-expect-error` outside a type test | `origin.ts:25:4 @ts-expect-error` |
   | Directives | `/* v8 ignore next */` | `origin.ts:25:4 v8 ignore` |
   | oxlint | `debugger;` | `eslint(no-debugger)` |
   | ESLint, i18n | `<p>Hello there</p>` in a web component | `i18next/no-literal-string` |
   | ESLint, size | a function of five parameters | `max-params` |
   | ESLint, size | a nested ternary | `no-nested-ternary`, `sonarjs/no-nested-conditional` |
   | Format | `export   const   messy={a:1}` | `Format issues found in above 1 files` |
   | Typecheck | `const wrong: number = "a"` | `TS2322` |
   | no-circular | two modules importing each other | `no-circular` |
   | no-build-output | server source importing `../../dist/bin.mjs` | `no-build-output` (after the fix above; before it, nothing) |
   | no-unresolvable | the server importing `@s10n-base/client`, undeclared | `no-unresolvable` |
   | packages-never-import-apps | `packages/shared` importing server source | `packages-never-import-apps` |
   | apps-never-import-each-other | a web component importing server source | `apps-never-import-each-other` |
   | clients-use-client-packages | the web app importing a new `packages/extra` | `clients-use-client-packages` |
   | server-uses-server-packages | the server importing `packages/client` | `server-uses-server-packages` |
   | client-package-imports | `packages/client` importing `packages/theme` | `client-package-imports` |
   | leaf-packages-import-no-package | `packages/contracts` importing `packages/shared` | `leaf-packages-import-no-package` |
   | i18n-imports-no-package | `packages/i18n` importing `packages/shared` | `i18n-imports-no-package` |
   | i18n-tests-import-contracts-only | an i18n test importing `packages/shared` | `i18n-tests-import-contracts-only` |
   | knip | an unused export in a package entry file | `Unused exports (1)` (after `includeEntryExports`; before it, nothing) |
   | Coverage | an untested function | `Coverage for lines (99.96%) does not meet global threshold (100%)` |
   | Exclusion list | `apps/web/src/mount.tsx` added to the config only | `vitest.config.ts excludes apps/web/src/mount.tsx, which the reviewed list does not` |
   | Exclusion wiring | an `if` in `set-role.ts` | `is excluded as wiring but has IfStatement at line 5` |
   | Audit triage | an acceptance matching no advisory | `no longer reported, so remove it from the triage` |
   | `agent:check` | the directive violation | `agent:check failed at lint:directives (exit 1)` |
   | Journeys | an inline script added to a page | the CSP violation as a console error |

   The audit's other failures (untriaged, expired) and every rule's fixture are covered by the scripts' tests.
4. **Locally:** `build`, `db:up`, `db:migrate`, `test:live` (49 tests), `smoke`, `mobile:export` and `test:e2e` (both journeys, also three times in a row) all pass.
5. **Counts:** suppressions 0; `@ts-expect-error` 2 files, both type-level tests; coverage exclusions 12 patterns; raised limits 0; lint allowances as listed above (oxlint: 7 rule settings repo-wide and 2 rules off in `apps/mobile`; ESLint: 4); knip exceptions 3 dependencies and the generated database file.
6. **Defects:** above.
7. **CI:** recorded in the pull request description for the head commit; all three jobs.
8. **Scrub:** the plan 000 check prints nothing, run before every push.

