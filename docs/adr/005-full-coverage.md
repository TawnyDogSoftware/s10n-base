# 005: Coverage is held at 100%, with one threshold and a reviewed exclusion list

- **Status:** Accepted, 2026-11-18.

## Context

A starter is copied into many projects, so an untested corner is copied many times. Coverage thresholds below 100% invite arguments about which lines may go untested, and each project built on this base that had a threshold had ended up at 100% anyway. Some files cannot be unit-tested in a useful way: the entry points that only wire a process together, generated code, and test helpers.

## Decision

- One merged coverage report over every app, package and script, with thresholds of 100% for lines, branches, functions and statements, stated once in the root `vitest.config.ts`. On by default.
- Exclusions are a reviewed list in `scripts/quality/coverage-exclusions.ts`. A gate fails when the config's exclusions differ from it, and when an excluded entry point holds more than wiring (imports and at most three statements without a branch, loop, `try`, function or class).
- Live-database tests do not count; unit tests reach 100% with no database, using a scripted Kysely driver for code that queries.
- A branch no input can reach is deleted, not covered.

## Consequences

- Every script's entry is a one-line `*.main.ts` over a tested module, and the server's entry points are cut down to wiring.
- Adding an exclusion is a visible change to two files, reviewed like code.
- Writing the test is part of every change, including small ones; tests must exercise behaviour, not only call functions.
- A project that cannot keep 100% has to lower the threshold deliberately, in one place.

## Revisit when

- The gate pushes contributors to write tests that assert nothing useful, in a way review keeps finding.
- A kind of code appears that cannot be tested in-process and is more than wiring (for example a native module), and needs a different rule.
