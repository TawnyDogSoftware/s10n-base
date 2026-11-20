# Quality gates

Every change passes the same gates locally and in CI. One command runs every gate that needs no database and no browser:

```bash
bun run agent:check
```

It runs the gates below in this order and stops at the first failure, naming it (`agent:check failed at lint:eslint (exit 1)`). CI's first job runs this same command, then builds, migrates, runs the live tests and the smoke test; a second job bundles the mobile app; a third runs the browser journeys; a fourth builds the container image and runs it in production mode (`bun run docker:smoke`, [deployment.md](deployment.md)). `scripts/ci-workflow.test.ts` fails if the first job stops running `agent:check`.

| Gate                | Run it alone                  | What it checks                                                        |
| ------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Commit attribution  | `bun run commits:attribution` | No commit message or pull request credits an AI tool                  |
| Directives          | `bun run lint:directives`     | No comment switches off a lint rule, a type error or coverage         |
| oxlint              | `bun run lint:oxlint`         | Correctness, suspicious code, performance, React hooks, accessibility |
| ESLint              | `bun run lint:eslint`         | Type-aware rules, sonarjs, the size limits, no hard-coded text in JSX |
| Format              | `bun run fmt:check`           | oxfmt's formatting (`bun run fmt` applies it)                         |
| Types               | `bun run typecheck`           | Every workspace, the scripts and the browser journeys                 |
| Boundaries          | `bun run boundaries`          | Which code may import which                                           |
| Dead code           | `bun run deadcode`            | Unused files, exports and dependencies                                |
| Coverage exclusions | `bun run coverage:exclusions` | The coverage config's exclusions equal the reviewed list              |
| Coverage            | `bun run test:coverage`       | 100% of lines, branches, functions and statements                     |
| Audit               | `bun run deps:audit`          | No advisory against an installed package that nobody has triaged      |

`bun run lint` runs the directive check, oxlint and ESLint. Outside `agent:check`: `bun run test:live` (needs the database), `bun run smoke` (needs a build and the database), `bun run test:e2e` (the browser journeys), and `bun run docker:build` then `bun run docker:smoke` (Docker and the database).

## Commit attribution

`bun run commits:attribution` (`scripts/quality/commit-attribution.ts`) reads the messages of the commits a branch proposes, from its merge base with the default branch (`origin/main`, else `origin/HEAD`, else `main`; `ATTRIBUTION_BASE` overrides it) to `HEAD`, and in CI the pull request's title and description (`PR_TITLE`, `PR_BODY`). It fails on a trailer that names an AI tool, an AI vendor's address, a "generated with" footer, a link to a tool's session, or a robot-emoji footer, naming the commit and the line. The rules are one list in that file, each with a test case; a person's `Co-authored-by:` passes. CI checks out the whole history so the merge base can be found; a checkout without the default branch or its history fails (exit 2) and says what git could not find.

To fix a failure, reword the commit (`git commit --amend`, or an interactive rebase for an older one) and push again; edit the pull request's text, which is checked again at the next push. To catch it before the commit exists, `bun run hooks:install` sets `core.hooksPath` to `.githooks`, whose `commit-msg` runs the same check on the message. It is optional, and there is no hook manager.

## The rule: fix the code, never the gate

A gate is met by fixing the code or adding the test, never by a suppression, an exclusion or a lowered limit. When a gate looks wrong for some code, the code usually has a real problem: a function doing too much, a branch nothing reaches, a value the types do not describe. If it truly cannot be met honestly, say so in the pull request and name the code; do not work around it.

### No suppressions

`bun run lint:directives` (`scripts/quality/lint-directives.ts`) reads every first-party file git tracks or would track and fails on:

- a comment that starts with `eslint-disable`, `eslint-enable`, `eslint ` (inline config), `oxlint-disable` or `oxlint-enable`;
- `@ts-ignore` or `@ts-nocheck`;
- `@ts-expect-error`, except in a type-level test: a file named `*.types.test.ts` or `*.types.test.tsx`, which the check lists when it passes;
- a coverage pragma: `v8 ignore`, `c8 ignore`, `istanbul ignore`, or `node:coverage ignore` / `disable`.

ESLint also runs with inline configuration off, so a comment could not switch a rule off even if one slipped through.

### Allowances

A rule a framework or library cannot satisfy is changed in the config, once, with its reason next to it. These are all of them:

- `.oxlintrc.json`:
  - `react/react-in-jsx-scope` off: the automatic JSX runtime.
  - `no-underscore-dangle` allows `_tag` (Effect's tagged unions) and `__type` (AWS's JSON errors).
  - `vitest/valid-expect` allows a second argument, Vitest's message.
  - `vitest/expect-expect` counts `expectTypeOf` and the web tests' `waitForLocation` as assertions.
  - `import/no-unassigned-import` allows stylesheets and `@testing-library/jest-dom/vitest`.
  - `react/style-prop-object` allows `StatusBar`, whose `style` is a string.
  - `no-await-in-loop` off: every loop it found waits on purpose, because each step depends on the one before (cursor pagination, rolling back one migration at a time, counting rate-limited attempts in order, polling a server until it answers). Independent work uses `Promise.all`.
  - In `apps/mobile`, `jsx-a11y/prefer-tag-over-role` and `jsx-a11y/role-has-required-aria-props` off: React Native has no HTML elements and no `aria-level`, so `role` is how a native view is named a heading, button or link.
- `eslint.config.mjs`:
  - `@typescript-eslint/only-throw-error` allows TanStack Router's `Redirect` in `apps/web`, the router's documented way to redirect from `beforeLoad`.
  - `sonarjs/no-os-command-from-path` off in `scripts/`, `e2e/` and tests: development tools run `git`, `bun`, `node` and `docker` from `PATH` as the developer's shell does. Nothing that ships runs a command.
  - `@typescript-eslint/no-require-imports` off in `.cjs` files: Metro's CommonJS config can only `require()`.
  - `no-undef` off in TypeScript files: TypeScript checks names itself.
- `knip.jsonc`: see [Dead code](#dead-code).

### Size limits

ESLint enforces cyclomatic complexity 10, cognitive complexity 15, nesting depth 3, at most 4 parameters, and no nested ternary, everywhere. When a function goes over, split it: name the steps, move a branch into a lookup table, pass an options object. If a limit ever forces a change that makes a function plainly worse, raise that limit for the whole repo by the smallest step and record the function here. None has been raised.

## Lint

oxlint runs first, with the `correctness`, `suspicious` and `perf` categories as errors and `--deny-warnings` (oxlint exits 0 on warnings otherwise). Its plugins cover React and its hook rules, imports, accessibility (`jsx-a11y`) and Vitest.

ESLint adds what oxlint does not have: `typescript-eslint`'s strict rules everywhere and `strictTypeChecked` on first-party source (`apps/*/src`, `packages/*/src`, `scripts`, `e2e`), `sonarjs` recommended, the size limits, and `i18next/no-literal-string` in the web and mobile components (tests excluded): every word a user reads comes from `packages/i18n` ([i18n.md](i18n.md)). The type-aware rules need Expo's typed routes, which are generated into the gitignored `apps/mobile/.expo`, so `lint:eslint` generates them first.

Ignored: generated output only (`dist`, `coverage`, `.turbo`, `apps/mobile/.expo`, `expo-env.d.ts`, Uniwind's generated types, the generated database types, Playwright's output).

## Boundaries

`.dependency-cruiser.cjs`, with type-only imports counted:

- no circular dependencies, and nothing imports build output (`dist`);
- every import resolves: an import of a workspace package the importer does not declare resolves to nothing (bun links each workspace's own dependencies only), and would otherwise slip past the rules below;
- packages never import apps, and apps never import each other;
- `apps/web` and `apps/mobile` import only `contracts`, `shared`, `client`, `theme` and `i18n`;
- `apps/server` imports only `contracts`, `shared` and `i18n`;
- `packages/client` imports only `contracts`, `shared` and `i18n`;
- `contracts`, `shared` and `theme` import no other workspace package;
- `i18n` imports no other workspace package, except that its tests import `contracts` to check there is a message for every error code.

`scripts/quality/boundaries.test.ts` runs the cruiser, with the config's own options, over small fixture trees that break each rule, so each rule is known to fire. (The options matter: an `exclude` that drops `dist` from the graph once hid every import of it from `no-build-output`.) A boundary failure means the import is in the wrong place: move the shared code into the package both sides may use.

## Dead code

`bun run deadcode` runs knip twice. The normal pass counts tests as users, and fails on unused files, exports and dependencies anywhere, package entry files included (`includeEntryExports`): an export no workspace imports is dead even when a package's `exports` map makes it reachable. The production pass starts from the production entry points alone (the `!` patterns in `knip.jsonc`) and fails on files and dependencies only tests and tools use; it does not report exports, since an export only a test imports is the normal pass's question.

When knip reports something, delete it, or stop exporting it. `knip.jsonc` names its exceptions with reasons: the server keeps `i18next` as a dependency because its bundle leaves that import external, and the mobile app's `expo-dev-client` and `expo-splash-screen` are config plugins that `app.config.ts` names and nothing imports. Test-only modules (the server's check helpers, the client package's fakes) are left out of the production project.

## Coverage

`vitest.config.ts` at the root runs every project's tests and merges one v8 report over `apps/*/src`, `packages/*/src` and `scripts`, with thresholds of 100 for lines, branches, functions and statements, stated there once. `bun run test:coverage` needs no database: the live tests (`*.live.test.ts`, `bun run test:live`) do not count toward it. Server code that runs queries is covered against `apps/server/src/test/scripted-db.ts`, a Kysely instance that compiles every query for Postgres and answers it from the test; whether the SQL itself is right is the live tests' job.

When coverage drops, write the test that exercises the behaviour, not one that only calls the function. A branch no input can reach is deleted, not covered.

### Exclusions

The config's `coverage.exclude` must equal the reviewed list in `scripts/quality/coverage-exclusions.ts` (`bun run coverage:exclusions`), so adding an exclusion is a deliberate change to two files. The list today:

| Pattern                                       | Why                                                          | What exercises it                                   |
| --------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `**/*.test.{ts,tsx}`                          | Tests                                                        | `bun run test`                                      |
| `apps/*/src/test/**`                          | Test support: fakes, render helpers, the live tests' harness | The tests that use them                             |
| `packages/client/src/test-fetch.ts`           | A fake fetch for the client package's tests                  | `packages/client`'s tests                           |
| `packages/client/src/testing/**`              | The fake server the client, web and mobile tests share       | The web and mobile tests                            |
| `**/*.d.ts`                                   | Type declarations                                            | `bun run typecheck`                                 |
| `apps/server/src/infra/postgres/generated/**` | Database types written by kysely-codegen                     | `bun run db:generate:check`, in CI                  |
| `apps/mobile/src/app/**`                      | expo-router route files, each re-exporting a screen          | The screens' tests; `bun run mobile:export`         |
| `apps/server/src/bin.ts`                      | The server process's entry point                             | `bun run smoke`, in CI                              |
| `apps/server/src/migrate.ts`                  | Passes the process's arguments and environment to the CLI    | `bun run db:migrate`, in CI                         |
| `apps/server/src/set-role.ts`                 | Passes the process's arguments and environment to the CLI    | `set-role-cli.live.test.ts`                         |
| `apps/web/src/main.tsx`                       | Loads the stylesheet and mounts the app                      | `bun run build` and `bun run test:e2e`              |
| `scripts/**/*.main.ts`                        | Script entry points                                          | The package.json scripts and CI steps that run them |

An excluded entry point must be wiring: imports, then at most 3 statements, none of them a branch (`if`, `?:`, `&&`, `||`, `??`, `switch`), a loop, a `try`, a function or a class. The check fails otherwise, so logic cannot hide in an entry point; move it into a module the tests cover and call it from there. That is why every script's entry is a one-line `*.main.ts` over a tested `*.ts`.

## Audit

`bun run deps:audit` runs `bun audit` and compares it with `dependency-audit-triage.json`. An advisory fails the gate unless the file accepts it:

```json
{
  "accepted": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",
      "package": "the-package",
      "reason": "Why it does not reach this repo, or why it waits for an upstream fix.",
      "expires": "2026-12-31"
    }
  ]
}
```

The acceptance ends at the start of `expires` (UTC), so the decision is looked at again. An entry that no longer matches any advisory also fails: remove it. Before accepting, prefer a fix: update the dependency (`bun run deps:update`, [dependencies.md](dependencies.md)) or add an override in `package.json` with its reason in [dependencies.md](dependencies.md). The list is empty today.

## Browser journeys

`e2e/` holds two journeys, run by Playwright in Chromium against the **built** server serving the **built** web app, so the real security headers apply:

1. Sign up with a fresh address, read the confirmation email from the capture server, confirm, sign in, sign out.
2. With a virtual authenticator, add a passkey on the profile page, sign out, sign in with the passkey, remove it.

Every page visited gets an axe check that fails on serious or critical violations, and any console error fails the journey; Chromium reports a Content-Security-Policy violation as a console error.

```bash
bunx playwright install chromium   # once, and after Playwright updates
bun run test:e2e                   # builds, then runs the journeys
```

Docker must be running: Playwright starts the compose database, applies the migrations to its `s10n_base_test` database, and starts the email capture server on port 8025 and the server on port 4310 (`e2e/env.ts`), so a `bun dev` already running is left alone. Each journey sends its own client address through one trusted proxy hop, so the sign-in rate limit (on in every environment) counts its attempts alone.

No trace, video or screenshot is recorded and CI uploads nothing: email links carry tokens and this repository is public. A failure is reported as text. Playwright writes its output, including a text page snapshot on failure, to the gitignored `e2e/test-results/`.
