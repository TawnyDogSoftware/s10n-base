# AGENTS.md

Rules for anyone, person or coding agent, about to change this repository. Each rule a gate enforces names the gate; the rest are enforced by review. `CLAUDE.md` imports this file.

## What this is

A starter for hosted, multi-user apps: a Node server on Postgres with Better Auth, a React web app and an Expo mobile app, sharing typed contracts, an API client, a theme and translations. It ships a signed-in blank slate (sign-up to profile and an admin user list), quality gates, CI and a container image. Projects start from it as a template ([docs/new-project.md](docs/new-project.md)).

```text
apps/server       node:http, Postgres (Kysely), Better Auth, RPC; entries: server, migrate, set-role
apps/web          React 19, Vite, TanStack Router and Query, Tailwind 4
apps/mobile       Expo SDK 58, expo-router, Uniwind
packages/contracts  Effect schemas: RPC methods with auth levels, AppSession, error codes
packages/client     RPC client, session client, session-gated query state, shared screen logic
packages/shared     small helpers that import nothing: app variants, cookie prefix, origin check
packages/theme      the Tailwind 4 token file both apps style with
packages/i18n       i18next catalogs with typed keys, for both apps and the server's emails
scripts/          dev, quality gates, dependency updates, rename, container and bundle checks
e2e/              Playwright browser journeys
docker/           Dockerfile and the local Postgres init script
plans/            numbered plans (plans/README.md); docs/adr/ decision records
```

## Commands

- `bun install`, then `bun dev`: Postgres, migrations, the server, the web app and the local email inbox ([docs/setup.md](docs/setup.md)).
- **`bun run agent:check` before every push.** It runs every gate that needs no database and no browser, in order, and stops at the first failure: commit attribution, the directive check, oxlint, ESLint, format, typecheck, boundaries, dead code, the coverage exclusion check, coverage, and the audit ([docs/quality.md](docs/quality.md)). CI's first job runs the same command.
- Outside it, each with what it needs, all run by CI:
  - `bun run test:live`: the server against Postgres (`bun run db:up` first).
  - `bun run build`, then `bun run smoke`: the built server starts, answers and stops cleanly (needs the database).
  - `bun run test:e2e`: the browser journeys in Chromium (Docker; `bunx playwright install chromium` once).
  - `bun run mobile:export`: Metro bundles both platforms and the bundle check passes.
  - `bun run docker:build`, then `bun run docker:smoke`: the image in production mode (Docker and the database).
  - `bun run rename:proof`: a renamed copy of the repository still passes (slow; mostly for changes to names, the rename script, or files it rewrites).
- `bun run fmt` formats; `bun run db:migrate`, `bun run db:generate` after a migration ([docs/setup.md](docs/setup.md#the-database)).

## Layering

Enforced by `bun run boundaries` (`.dependency-cruiser.cjs`), type-only imports included:

- No circular imports, no import of build output, and every import resolves: an app or package imports only workspace packages it declares.
- Packages never import apps; apps never import each other.
- `apps/web` and `apps/mobile` import only `contracts`, `shared`, `client`, `theme` and `i18n`. **The server is never imported by client code.**
- `apps/server` imports only `contracts`, `shared` and `i18n`. **The server never imports `client` or `theme`.**
- `packages/client` imports only `contracts`, `shared` and `i18n`. `contracts`, `shared` and `theme` import no workspace package; `i18n` imports none except `contracts` in its tests.
- Code both sides need goes in the package both may use. Cross-boundary shapes live in `packages/contracts`; it holds schemas, not runtime logic.

## Dependencies

- **Prefer a platform API or a package already in the catalog.** A new dependency needs its reason in the body of the commit that adds it. Versions go in the root `catalog` and workspaces use `catalog:`.
- **The 3-day rule:** every package is on the newest release at least three days old; `bunfig.toml` enforces it at install. Held packages and their reasons are in `dependency-holds.json`. How to take a bug-fix release early, and how the daily update PR works: [docs/dependencies.md](docs/dependencies.md).
- **Expo-managed packages** (React, React Native, every native module) are added and moved only with `EXPO_OFFLINE=1 bunx expo install <package>` in `apps/mobile`. CI checks with `expo install --check`.
- **A run-time dependency of the server must be declared in `apps/server/package.json`.** The bundle leaves third-party imports external, and the image build fails when its imports and the declared dependencies differ.
- `better-auth`, `@better-auth/expo`, `@better-auth/passkey` and `better-call` move together, in one change (`scripts/dependency-updates/holds.test.ts`).
- **No git-hook manager.** Optional hooks live in `.githooks/`, turned on with `bun run hooks:install` (`core.hooksPath`).
- **Scripts are TypeScript run with bun.** A script's entry is a one-line `*.main.ts` over a tested module; the coverage exclusion check fails if an entry holds more than wiring.

## Code rules the gates enforce

- **No suppression comments**: no `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck`, coverage pragma, or `@ts-expect-error` outside a `*.types.test.ts` file (`bun run lint:directives`). An allowance a framework needs goes in the lint config, with its reason, once.
- **100% coverage** of lines, branches, functions and statements, with the database stopped (`bun run test:coverage`). Exclusions are a reviewed list (`bun run coverage:exclusions`); adding one is a deliberate change to two files. Test behaviour, not lines; delete a branch nothing can reach.
- **No hard-coded user-visible string** in a web or mobile component: every word comes from `packages/i18n` (ESLint's `i18next/no-literal-string`; [docs/i18n.md](docs/i18n.md)). No colour or radius outside `packages/theme/theme.css`.
- **Size limits**: complexity 10, cognitive complexity 15, nesting depth 3, 4 parameters, no nested ternary (ESLint). Split the function; never raise a limit for one file.
- **No unused files, exports or dependencies** (`bun run deadcode`).
- A gate is met by fixing the code or adding the test, never by an exclusion, a suppression or a lowered limit. If that seems impossible, say so in the pull request and name the code.

## Server rules

- **Every RPC method declares its auth level** (`"public"`, `"session"` or `{ role }`) in its contract, and one dispatcher enforces it before the payload is decoded. `defineRpc` has no default, and the registry test fails when a contract has no handler or a handler no contract.
- **Migrations are numbered and append-only**: a new file in `apps/server/src/infra/postgres/migrations/`, added to the explicit map in its `index.ts`, then `bun run db:generate`. A merged migration is never edited or removed. The server never migrates; it refuses to start while a migration in its build is pending.
- **Configuration goes through the config module** (`apps/server/src/config/index.ts`), which validates every variable at startup. A new variable also goes in `.env.example`, `turbo.json`'s `globalEnv`, and the tables in `docs/setup.md` and `docs/deployment.md` (`environment-table.test.ts` compares the second with the code).
- **Logs are JSON lines on stdout through the logger** (`apps/server/src/observability/logger.ts`); nothing else in the server writes to the console or to files.
- Nothing is kept in memory between requests or written to local disk: any instance must be able to answer any request ([docs/deployment.md](docs/deployment.md#more-than-one-instance)).

## Auth rules

- A Better Auth upgrade or a new plugin that adds an endpoint fails a test until the endpoint is decided in `apps/server/src/auth/allowed-routes.ts`, as exposed or not, with a reason. Clients read `AppSession`, not Better Auth's objects.
- The pitfalls from [docs/auth.md](docs/auth.md#pitfalls-our-projects-reviews-found): **read the clock after taking row locks**, not before; **recheck the session inside a transaction** that acts on its authority (an RPC handler that writes on the caller's authority runs its writes in `sessionTransaction`, `apps/server/src/rpc/session-transaction.ts`); **treat a lost response to a security action as an unknown outcome**, re-read the state, and never report it as a failure.

## Plans and decisions

- A change bigger than a fix starts as a plan: `plans/NNN-slug.md`, the next number from [plans/README.md](plans/README.md), added to its index in the same commit. Numbers are never reused (`scripts/numbered-index.test.ts`).
- Whoever implements a plan fills in its **How it was built** section: what the code settled, every departure with its reason, and what was verified.
- A decision that outlives a plan gets a record in [docs/adr/](docs/adr/README.md).

## Commits and pull requests

- A short imperative subject. A body that says what was wrong or missing and what changed, in plain sentences.
- **No mention of AI tooling, and no attribution trailers or footers**: no `Co-Authored-By` naming a tool, no "Generated with" line, in commit messages, pull request titles or descriptions. `bun run commits:attribution` checks the branch's commits and, in CI, the pull request's text; it is the first gate of `agent:check`. `bun run hooks:install` runs it on each commit message too.
- `.claude/implement-plan.md` describes how a plan becomes a pull request.

## Changelog

Every scaffold-level change gets an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md): what changed and why, written for someone maintaining a project made from an earlier version of the base, who will decide from it what to port. The owner tags releases.
