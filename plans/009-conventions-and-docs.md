# 009: Conventions and docs

> Status: in progress since 2026-11-20, on branch `feature/001-strip-desktop-and-local-first` (the rework's single pull request).

Phase 9 of [000](000-hosted-starter-rework.md), the last phase that changes this repo. Builds on phases 1 to 8.

## 1. Goal

Make the base usable as a template by someone who was not here for the rework: the rules written down where people and coding agents will read them, the one rule that can be checked by a machine checked in CI, a rename script that replaces the manual checklist, and a README and docs that describe what the repo now is.

## 2. Out of scope

| Not in this phase | Owner |
|---|---|
| Turning on GitHub's "Template repository" setting | The owner, after the rework lands |
| Creating the dependency-update GitHub App and its secrets | The owner |
| The first boot of the mobile app on a Mac | The owner (plan 006) |
| Backport plans for existing projects | Phase 10, in their own repos |
| New features, new dependencies, behaviour changes | |

No dependency is added. Two small leftovers from earlier phases are fixed here because they are cheap and otherwise orphaned: the dependency-update dry run leaving an empty temporary directory behind when it cannot create its worktree (plan 008's finisher), and the Vite warning about an extensionless import in `apps/web/vite.config.ts` if it can be removed without a behaviour change (if not, leave it and say why).

## 3. `AGENTS.md` and `CLAUDE.md`

`AGENTS.md` at the repo root is the single source; `CLAUDE.md` contains only an import of it. Written for someone, or something, about to change this repo. Short, imperative, and every claim true of the code today. Each rule that a gate enforces names the gate. Sections:

- **What this is** in three lines, and the layout.
- **Commands:** `bun dev`; `bun run agent:check` as the one check to run before pushing; the checks outside it and what each needs (`test:live`, `smoke`, `test:e2e`, `mobile:export`, `docker:build`, `docker:smoke`); pointers to `docs/setup.md` and `docs/quality.md`.
- **Layering:** which package may import which (the dependency-cruiser rules, in words), and that the server never imports client code.
- **Dependencies:** prefer a platform API or a package already kept; a new dependency needs a stated reason in the commit that adds it; the 3-day rule and the hold list (`docs/dependencies.md`); Expo-managed packages only through `expo install`; a run-time dependency of the server must be declared in `apps/server/package.json` or the image build fails; no git-hook manager, use `core.hooksPath`; TypeScript scripts run with bun, and a script's entry is a one-line `*.main.ts` over a tested module.
- **Code rules that gates enforce:** no suppression comments; 100% coverage with a reviewed exclusion list; no hard-coded user-visible string; the size limits; no unused exports.
- **Server rules:** every RPC method declares its auth level; migrations are numbered and append-only and the API never migrates on start; config goes through the config module and is documented in the environment table; logs are JSON on stdout through the logger.
- **Auth rules:** the Better Auth packages and `better-call` move together; a new Better Auth endpoint is a decision in the allow-list; the three pitfalls from `docs/auth.md`.
- **Plans:** `plans/NNN-slug.md`, numbered from the index, numbers never reused; a plan records how it was built.
- **Commits and pull requests:** imperative subject, a body that says what was wrong and what changed, and **no mention of AI tooling and no attribution trailers or footers**, which CI checks (section 4).
- **Changelog:** every scaffold-level change gets an entry.

Also `.claude/implement-plan.md`: project notes for the `implement-plan` skill (plan layout, the gate commands, branch naming, the PR description format), consistent with `AGENTS.md`.

## 4. The commit-attribution check

- `scripts/quality/commit-attribution.ts` (tested module, one-line `*.main.ts` entry): reads the messages of the commits being proposed (the range from the merge base with the default branch to `HEAD`) and fails on an attribution trailer naming an AI tool or its vendor's no-reply address, or on a "generated with" style footer. An ordinary `Co-authored-by:` line for a person passes. The patterns live in one list with a test case each, and the failure message says which commit and which line.
- It also checks a pull request's title and description when CI provides them.
- It is a gate in `agent:check` and runs in CI, where the checkout needs enough history for the range. It must pass on this branch as it stands; if an existing commit fails, stop and report it rather than rewriting history.
- `.githooks/commit-msg` runs the same check on one message, and `bun run hooks:install` sets `core.hooksPath`. Optional for a developer, documented in `AGENTS.md`. No hook manager.
- As plan 007 requires of every gate: show it failing once on a planted commit in a throwaway clone.

## 5. Plans index and decision records

- `plans/README.md`: the convention, and a table of every plan with its number, title and status. Numbers are never reused. A test fails when a `plans/NNN-*.md` file is missing from the index, a number is duplicated, or an indexed file does not exist.
- `docs/adr/`: a `README.md` with the format (context, decision, consequences, status) and numbering, and one short record for each of the ten decisions in plan 000 section 4, written so it stands alone: what was decided, why, and what would make us revisit it. They follow the scrub rule like everything else: the reasons are given in general terms, and the three private projects appear only as "Project A/B/C" where a reason depends on them.
- Plan 000: final status. Every phase's state stated plainly, including "phase 6: implemented, first boot on a Mac pending", "phase 10: not started, in the projects' own repos", and the owner steps that remain.

## 6. The rename script

`bun run rename`, replacing `CUSTOMIZATION_GUIDE.md`'s manual checklist, which is deleted.

- **Inputs** (flags; all validated before anything is written): display name; package scope (`@acme`); slug (`acme-app`); reverse-domain bundle identifier base (`com.acme.app`); URL scheme; cookie prefix (default: derived from the slug). A `--dry-run` lists every file and replacement without writing.
- **It refuses to run** on a dirty working tree, or twice (it detects that the base's names are gone).
- **What it must cover.** Earlier plans' "for phase 9" notes list much of it; do not trust the lists, find every occurrence:
  - the package scope in every manifest, import, config and tool file (tsconfig, tsdown's bundling pattern, Vitest, knip, dependency-cruiser, ESLint, Metro, Docker);
  - the root package name and the workspace name recorded in `bun.lock` (it is still the pre-rework scaffold name);
  - the app's display name: server config, the i18n catalog, the web page title, the mobile variants;
  - URL schemes, bundle identifiers and names in the variant table; the Expo slug, and the development client's scheme derived from it;
  - the cookie prefix;
  - any environment variable that carries the base's name;
  - the image tag and title label, and the compose project, database and role names, in the compose file, the scripts and CI;
  - names in workflows and docs.
- **What it must leave alone:** `plans/`, `CHANGELOG.md` history, `docs/adr/`, the upstream credit in the README, third-party names, and the lockfile's package entries (after rewriting manifests it runs `bun install` so the lockfile is regenerated by bun, and then checks that no package version changed).
- **Afterwards** it prints what a person still has to do (section 7's list).
- **Tests:** unit tests for validation and for each kind of replacement on fixture files. And the real proof, as a script and a fifth CI job: copy the repo to a temporary directory, run the rename with sample values, then in the copy run the install, `agent:check`, the build and the mobile export, and assert that no occurrence of the base's names remains outside the allowed files. A rename that leaves the repo broken is the failure this script exists to prevent, so this job is not optional.

## 7. README and docs

- **`README.md`, rewritten** for what the repo is now:
  - what it is and who it is for, in a paragraph;
  - what is built in (server, web, mobile, auth, email, database, gates, CI, image), each in a line;
  - quick start: prerequisites, `bun dev`, where the app and the local inbox are, how to become an admin;
  - the layout;
  - the commands;
  - starting a new project from it (a pointer to `docs/new-project.md`);
  - a docs index;
  - the conventions in five lines with a pointer to `AGENTS.md`;
  - the credit to the upstream project it was derived from.
  - Nothing in it describes the desktop past, and nothing in it is untrue of the code. No badge or claim that cannot be checked.
- **`docs/new-project.md`:** "Use this template" (once the owner has turned the setting on); run the rename; what to delete or keep from the base's history (`plans/` and the changelog entries of the rework are the base's, not the new project's; start the project's own plans at 001); install the dependency-update GitHub App on the new repo and add the two secrets, since a template copy brings workflows but not secrets; choose bundle identifiers before the first store build; set the EAS project id; the first admin; then `docs/deployment.md`.
- **`docs/README.md`:** an index of the docs with one line each.
- Read every existing doc once against the code and fix what is stale. Earlier phases each updated their own docs; nobody has read them as a set. List what you corrected.
- **`CHANGELOG.md`:** organise the rework's entries into one coherent section a reader can follow (they were appended phase by phase), with a short note at the top on how a project made from the base uses this file (D9: read the changelog, port what you want; there is no merge from the base). Do not invent a version number or a release date; leave it as unreleased and say the owner tags it.

## 8. The pull request description

This phase completes the single pull request, so finish its description: after adding `## Phase 9`, put a summary at the top (what the PR does, in a few lines), and a section "Needs the owner" listing every step that only the owner can do, each with where the instructions are:

- boot the mobile app on a Mac from a fresh clone (`docs/mobile-first-boot.md`);
- create the dependency-update GitHub App, install it, add `DEPS_UPDATE_APP_CLIENT_ID` and `DEPS_UPDATE_APP_PRIVATE_KEY`, and run the workflow once by hand (`docs/dependencies.md`);
- turn on the "Template repository" setting;
- look at the web screens in light and dark mode;
- phase 10.

Keep the per-phase sections as they are.

## 9. Verification and definition of done

On the final commit, recorded in section 10 and the PR description:

1. From clean: frozen install, `bun run agent:check` with the new gate in it, 100% coverage including the new scripts.
2. `build`, database up, `test:live`, `smoke`, `test:e2e`, `mobile:export`, `docker:build`, `docker:smoke`.
3. The rename proof run locally with sample values: the output of the leftover search, and each command's result in the renamed copy.
4. The attribution check failing on a planted commit, and passing on this branch.
5. Every command and path named in `AGENTS.md`, `README.md` and `docs/new-project.md` exists and works: check them mechanically where you can (a test that every `bun run <name>` mentioned in those files is a real script, and every relative link resolves) and by hand otherwise.
6. `git grep` finds no remaining reference to the desktop app, the deleted guide, or a doc that no longer exists.
7. CI green on the head commit: all five jobs.
8. The scrub check from plan 000 prints nothing. The decision records and the README get a second, careful read for anything that describes a private project.

Done when sections 3 to 8 are in and the above passes, and section 10 records the list of docs corrected, everything the rename covers, and every departure with its reason.

## 10. How it was built

Filled in by the implementor.
