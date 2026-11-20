# 004: Lint with oxlint, type-checked ESLint, knip and dependency-cruiser

- **Status:** Accepted, 2026-11-18.

## Context

The scaffold had oxlint only. oxlint is fast and covers correctness, React hooks and accessibility, but it has no type-aware rules, no complexity limits of the kind sonarjs provides, no check for unused exports or dependencies, and no rules about which package may import which. Two of the three projects built on this base had added ESLint with sonarjs, knip and dependency-cruiser on top of oxlint, and their gates caught real defects; the third ran oxlint alone. Code written with an agent's help in particular drifts in size and layering unless a machine says no.

## Decision

Four tools, all gates in `bun run agent:check` ([docs/quality.md](../quality.md)):

- **oxlint** first, with correctness, suspicious and performance rules as errors.
- **ESLint** with `typescript-eslint`'s strict and type-checked rules, `eslint-plugin-sonarjs`, size limits (complexity, cognitive complexity, nesting depth, parameter count), and `eslint-plugin-i18next`'s rule against hard-coded text in components.
- **knip** for unused files, exports and dependencies.
- **dependency-cruiser** for the layering rules between apps and packages.

No suppression comment is allowed anywhere; an allowance a framework needs goes in the config with its reason.

## Consequences

- Type-aware rules and size limits catch problems oxlint cannot, and the boundary rules keep the server out of client code and the reverse.
- Linting is slower: ESLint with the type checker is most of `agent:check`'s lint time.
- `typescript-eslint` and `eslint-plugin-sonarjs` support TypeScript only below 6.1, so this decision holds TypeScript back ([006](006-toolchain.md)).
- Four configs to keep in step when the layout changes.

## Revisit when

- oxlint's type-aware linting covers the rules we rely on, so ESLint can go.
- `typescript-eslint` and sonarjs support TypeScript 7, or ESLint becomes the only thing holding the toolchain back.
