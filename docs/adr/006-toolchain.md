# 006: Stay on bun, turbo and TypeScript 6.0, with a 3-day release rule

- **Status:** Accepted, 2026-11-18.

## Context

The upstream project this base was derived from has since moved to pnpm, to Vite+ for its task running and testing, and toward the TypeScript 7 era's native type checker. Following it would change every script, every test import and the type checker at once. Separately, a package release that turns out to be broken or malicious is usually pulled or fixed within days, and the base takes updates every day.

## Decision

- **Package manager and tasks:** stay on bun (1.4.x) and turbo.
- **TypeScript:** `~6.0.3`, with zero deprecation warnings, because TypeScript 7 turns them into errors.
- **The 3-day rule:** every package and tool is on the newest stable release that is at least three days old, enforced by bun's `minimumReleaseAge` in `bunfig.toml` and applied by a daily update workflow ([docs/dependencies.md](../dependencies.md)).

## Consequences

- One toolchain for web, mobile and server: bun installs Expo and React Native and runs every script.
- TypeScript stays a minor line behind; `dependency-holds.json` holds it below 6.1 with its reason.
- A bug-fix release can be taken early only by naming it, and the packages published with it, in `bunfig.toml`, with a removal date.
- The upstream's measured CI gain from pnpm was almost all install time, and the move broke its release builds several times on pnpm details; we keep that cost off this base.

## Revisit when

- **pnpm:** we adopt Vite+, or bun causes trouble with Expo or EAS builds.
- **Vite+:** it has a documented remote cache and a few months of releases without breaking changes. Adopting it means rewriting every test import, and it has no documented Expo story.
- **TypeScript 7:** 7.1 is stable and `typescript-eslint` and `eslint-plugin-sonarjs` support it ([004](004-lint-stack.md)).
- **The 3-day rule:** a supply-chain incident shows three days is too short, or the rule keeps a security fix out for too long.
