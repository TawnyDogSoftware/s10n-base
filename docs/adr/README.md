# Architecture decision records

A decision record says what was decided, why, and what would make us decide again. It is short and stands on its own: someone who reads only the record, months later, can tell whether the decision still holds. The plans in [plans/](../../plans/README.md) say how something was built; a record keeps the decision behind it.

## The format

- **File:** `docs/adr/NNN-slug.md`, numbered in order from the index below. Numbers are never reused.
- **First line:** `# NNN: Title`, where the title states the decision, not the question.
- **Status:** `Accepted`, with the date, or `Superseded by NNN`. A decision is never edited into a different one: a new record supersedes the old, and the old one's status points at it.
- **Context:** the problem and the forces at play, in a few sentences.
- **Decision:** what we do.
- **Consequences:** what follows, good and bad, including what it costs.
- **Revisit when:** the concrete signs that would make us decide again.

`scripts/numbered-index.test.ts` checks this index the same way as the plans': every record listed once, with its title, and nothing listed that does not exist.

The first ten records are the decisions settled with the owner when the base was reworked into a hosted starter (plan 000, section 4). Where a reason rests on the private projects built from the base, they are called Project A, B and C, as in plan 000.

## Index

| Number | Decision                                                                                                             | Status   |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| 001    | [Effect's stable core runs the server's lifecycle; HTTP stays on node:http](001-effect-core-on-the-server.md)        | Accepted |
| 002    | [Better Auth is mounted behind a bridge and a route allow-list](002-better-auth-behind-an-allow-list.md)             | Accepted |
| 003    | [Email and password, the Expo and admin plugins, and passkeys are on by default](003-auth-features-on-by-default.md) | Accepted |
| 004    | [Lint with oxlint, type-checked ESLint, knip and dependency-cruiser](004-lint-stack.md)                              | Accepted |
| 005    | [Coverage is held at 100%, with one threshold and a reviewed exclusion list](005-full-coverage.md)                   | Accepted |
| 006    | [Stay on bun, turbo and TypeScript 6.0, with a 3-day release rule](006-toolchain.md)                                 | Accepted |
| 007    | [Style mobile with Uniwind on one shared token file](007-uniwind-and-a-shared-theme.md)                              | Accepted |
| 008    | [The example domain is an account profile and an admin user list](008-example-domain.md)                             | Accepted |
| 009    | [The base is a template with a changelog, not an upstream to merge](009-a-template-not-an-upstream.md)               | Accepted |
| 010    | [The base ships no infrastructure code; projects use Terraform](010-no-infrastructure-code.md)                       | Accepted |
