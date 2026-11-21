# Project notes for implementing a plan

How a plan in this repository becomes a pull request. [AGENTS.md](../AGENTS.md) has the rules these notes rely on; where the two differ, AGENTS.md wins and this file is wrong.

## Plans

- Plans are `plans/NNN-slug.md`, listed in [plans/README.md](../plans/README.md). A new plan takes the next unused number and its row in the index, in the same commit.
- Read the plan, the plans it builds on (their **How it was built** sections end with notes for later work), the decision records in `docs/adr/` it touches, and the code it changes.
- Set the plan's status line to in progress, with the date and the branch, in the first commit. Mark it implemented, and update its row in `plans/README.md`, when it is done.
- Fill in **How it was built**: what the code settled that the plan left open, every departure with its reason, what was verified and the result, and what later plans need to know. A claim in an earlier plan that turned out wrong is corrected there too, saying so.

## Branches

`feature/NNN-slug` from an up-to-date `main`, unless the owner names another.

## The gates

Run before every push, after `bun run fmt`:

- `bun run agent:check`, always. It must pass with no new suppression, no new coverage exclusion beyond a one-line `*.main.ts` entry, and no raised limit.
- Then whichever of these the change touches: `bun run test:live` (server and database code; `bun run db:up` first), `bun run build` and `bun run smoke` (the server's startup, config or HTTP layer), `bun run test:e2e` (web screens, auth, security headers), `bun run mobile:export` (mobile, shared packages, Metro), `bun run docker:build` and `bun run docker:smoke` (the image, the server's run-time dependencies), `bun run rename:proof` (names, the rename script, or files it rewrites). CI runs all of them on every push.

## Commits

A short imperative subject; a body that says what was wrong or missing and what changed. **No mention of AI tooling and no attribution trailer or footer** in a commit message, pull request title or description: `bun run commits:attribution` fails on them, locally and in CI. Commit and push in small steps.

## The pull request

Title: the plan's title. The description:

1. A link to the plan and its goal in a sentence or two.
2. `##` sections by area (server, web, mobile, packages, scripts, CI, docs): what changed and why.
3. `## Tests`: every verification item in the plan with its actual result on the final commit, and the CI run.
4. `## Needs a person or a device`: what could not be checked here, with where the instructions are.
5. Departures from the plan, each with its reason.

Every scaffold-level change also gets an entry in `CHANGELOG.md`.

## Review

Answer every review finding: fixed (with the commit and the test that covers it) or declined (with the reason). A finding that would change a recorded decision (`docs/adr/`) goes to the owner instead of into the code.
