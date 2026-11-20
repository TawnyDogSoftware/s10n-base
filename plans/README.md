# Plans

Every change bigger than a fix starts as a plan in this folder, is reviewed as a plan, and is then built from it. The plan stays afterwards as the record of what was decided and why.

## The convention

- **One file per plan:** `plans/NNN-slug.md`, where `NNN` is the next unused number in the table below. Add the row in the same commit as the plan.
- **Numbers are never reused.** A plan that is dropped keeps its file and its row, with the status "Withdrawn" and a line saying why. A later plan that replaces part of an earlier one says so in both.
- **The first line** is `# NNN: Title`, and the title in the table is the same. The second is a status line: `> Status: not started`, `in progress`, `implemented on <date>`, or `withdrawn`.
- **Sections:** the goal, what is out of scope, the work, verification and the definition of done, and **How it was built**, which whoever implements the plan fills in: what the code settled that the plan left open, every departure with its reason, what was verified and how, and what later plans need to know.
- **Formatting:** the formatter leaves `plans/` alone (`.oxfmtrc.json`), so a plan's tables keep the shape they were written in.
- `scripts/numbered-index.test.ts` fails when a plan file is missing from the table, a number is used twice, the table lists a file that does not exist, or a row's title or number differs from its file.

Decisions that outlive a plan are also written up as decision records in [docs/adr](../docs/adr/README.md).

**In a project made from this template,** the plans below are the base's history, not the project's: delete them (or keep them for reference) and start the project's own plans at 001 ([docs/new-project.md](../docs/new-project.md)).

## Index

| Number | Plan | Status |
| --- | --- | --- |
| 000 | [Rework s10n-base into a hosted web and mobile starter](000-hosted-starter-rework.md) | Approved; phases 1 to 9 implemented; phase 10 not started |
| 001 | [Strip the desktop and local-first layer](001-strip-desktop-and-local-first.md) | Implemented |
| 002 | [Toolchain and package upgrade, minimal CI, daily dependency updates](002-toolchain-upgrade-and-ci.md) | Implemented |
| 003 | [Hosted server core](003-hosted-server-core.md) | Implemented |
| 004 | [Auth](004-auth.md) | Implemented |
| 005 | [Web blank slate](005-web-blank-slate.md) | Implemented |
| 006 | [Mobile blank slate](006-mobile-blank-slate.md) | Implemented; first boot on a Mac pending |
| 007 | [Quality gates](007-quality-gates.md) | Implemented |
| 008 | [Deployment kit](008-deployment-kit.md) | Implemented |
| 009 | [Conventions and docs](009-conventions-and-docs.md) | Implemented |
| 010 | [Recheck the session inside the profile update](010-recheck-session-in-profile-update.md) | Not started |
