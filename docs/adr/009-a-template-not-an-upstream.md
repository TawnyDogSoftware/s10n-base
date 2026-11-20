# 009: The base is a template with a changelog, not an upstream to merge

- **Status:** Accepted, 2026-11-18.

## Context

Projects built on the earlier scaffold diverged from it within days: renamed, restructured, and with their own fixes to the same problems. Merging later changes from the base into them would conflict on nearly every file. Still, the base keeps improving, and projects want to know what changed and whether to take it.

## Decision

- The base is a **template**. A new project starts from it with GitHub's "Use this template" (a clean history), then runs the rename script and goes its own way.
- The base keeps **`CHANGELOG.md`**, recording every scaffold-level change and why. Projects read it and port what they want, by hand; there is no merge from the base.
- Each project that already exists gets a **backport plan** in its own repository, listing which base changes are worth porting and in what order (plan 000, phase 10).

## Consequences

- A project owns all of its code from the first commit, with no upstream remote to keep in step with.
- Every scaffold-level change in the base must have a changelog entry that a project can act on; this is part of the definition of done for base changes ([AGENTS.md](../../AGENTS.md)).
- Porting is manual and selective. A fix in the base reaches a project only when someone there reads the changelog.
- A template copies workflows but not secrets or the repository's settings, so each new project sets up the dependency-update app's secrets itself ([docs/new-project.md](../new-project.md)).

## Revisit when

- Projects keep porting the same changes in the same way, so a shared package would serve them better than a copy.
- The base and its projects stop diverging, which would make merging feasible.
