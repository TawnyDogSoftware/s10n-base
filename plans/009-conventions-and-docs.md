# 009: Conventions and docs

> Status: implemented on 2026-11-20, on branch `feature/001-strip-desktop-and-local-first` (the rework's single pull request). Section 10 records how.

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

Implemented on 2026-11-20 on Linux, Node 26.13.1 and bun 1.4.4, with Docker for the local Postgres and the image. No dependency was added.

### The commit-attribution check (section 4)

`scripts/quality/commit-attribution.ts`, run by `bun run commits:attribution`, first in `agent:check`. It reads the messages from the merge base of `HEAD` with the default branch to `HEAD`, plus `PR_TITLE` and `PR_BODY` when CI sets them, and fails naming the commit (or "pull request description") and the line. The rules, one list, each with an example that its test must catch, a line reported under the first it breaks:

| Rule | Catches |
| --- | --- |
| An AI vendor's address | an address at `anthropic.com`, `openai.com`, `cursor.com`, `cursor.sh` or `devin.ai`, and Copilot's two addresses |
| A trailer naming an AI tool | a `*-by:` trailer (co-authored, assisted, generated, signed off, ...) naming Claude Code or a Claude model, Anthropic, OpenAI, ChatGPT, GPT-n, Codex, Copilot, Gemini, Cursor, Devin, Aider, Windsurf, Codeium, Tabnine, CodeWhisperer or Amazon Q |
| A generated-with footer | "generated with/by/using/via" followed by one of those names or "AI" |
| A link to a tool's session or product page | `claude.ai/code`, `claude.com/claude-code`, `chatgpt.com/codex` |
| A robot-emoji footer | a line starting with the robot emoji |

Tool names count only in trailers, because this branch's own history uses "cursor" in prose (cursor pagination); those lines are test cases that must pass, as are a person's `Co-authored-by:` and a person named Claude. The patterns live in the check, AGENTS.md and `.claude/implement-plan.md` name the rule, and no commit message or pull request text here does.

- **CI** checks out the first job with `fetch-depth: 0` and passes the pull request's title and description through `env`, never into a shell command. CI does not run on a description edit, so an edited description is checked at the next push.
- **The base branch:** `origin/main`, then `origin/HEAD`, then `main`; `ATTRIBUTION_BASE` overrides. `origin/HEAD` came first at first, and a planted commit in a local clone showed why that was wrong: a clone of a feature checkout points `origin/HEAD` at the feature branch, so the range was empty and the check passed without reading anything. A checkout with no default branch exits 2 saying what git could not find.
- **The hook:** `.githooks/commit-msg` runs the check with `--message-file`, dropping git's `#` comment lines; `bun run hooks:install` sets `core.hooksPath`.
- **Shown failing** in a throwaway clone: a planted empty commit with a vendor-address co-author trailer gave `commit 44133ac line 3: an AI vendor's address: ...` and exit 1, and with the hook installed, `git commit` of a message ending "Generated with Codex" was refused (`this commit message line 3: a generated-with footer: ...`, exit 1). Removing the planted commit, the check passed. **On this branch** it passes: every commit since `main` checked, none credits a tool, and CI's first job has run it with this pull request's title and description.

### Plans index and decision records (section 5)

`plans/README.md` states the convention (number from the index, never reused, a withdrawn plan keeps its file and row, the heading and status lines, How it was built) and indexes plans 000 to 009. `docs/adr/` has its README (format, numbering, superseding) and one record per decision D1 to D10, numbered like the plans (`NNN-slug.md`). `scripts/numbered-index.ts` checks both indexes: every `NNN-*.md` listed once, its title equal to the file's `# NNN: Title`, a status, no number used twice, no listed file missing. Plan 000's status is final (above section 1).

### The rename script (section 6)

`scripts/rename/`: `rules.ts` (the names, the rules, the kept files, the leftover search, the lockfile's versions), `arguments.ts` (flags and validation), `rename.ts` (the command) and `proof.ts` (the proof), each with a one-line `*.main.ts`.

**What it covers.** Seven rules, applied in this order to every tracked text file outside the kept ones (the scope and the cookie prefix are spelled like the slug, and the bundle identifier contains the scheme, so the narrower rule runs first):

| Rule | Base value | Where it occurs |
| --- | --- | --- |
| Package scope | `@s10n-base/` | every workspace manifest's name and dependencies; imports and stylesheet imports in all apps, packages and scripts; the server bundler's pattern in `tsdown.config.ts` (`/^@s10n-base\//`); turbo filters in the root scripts; `knip.jsonc`; the bundle check's message; docs; and `bun.lock`'s workspace entries |
| Bundle identifier | `com.example.s10nbase` | the variant table (`.dev`, `.preview` and production), `docs/mobile-dev.md` |
| Display name | `S10N Base` | the server's config (also the passkey relying party's name), the i18n catalog's `appName`, the web page title, the variants' names (`(Dev)`, `(Preview)`), the README's title, docs and tests |
| Cookie prefix | `s10n-base` before `.` or `\.`, and `AUTH_COOKIE_PREFIX = "s10n-base"` | the constant in `packages/shared/src/auth.ts`, a comment in the server's options, cookie strings and a cookie pattern in tests, `docs/auth.md` |
| URL scheme | `s10nbase` | the variant table (`-dev`, `-preview` and production), trusted-origin tests, `docs/mobile-dev.md` |
| Database name | `s10n_base` | the compose file's user, password and database, the init script's test database, `.env.example`, CI's two Postgres services and URLs, the e2e environment, docs |
| Slug | `s10n-base` | the root package's name, the lockfile's root workspace, the Expo slug and the dev client's scheme made from it (`exp+s10n-base`), the compose project (`s10n-base-local`), the image tag (`s10n-base:local`) in `package.json`, CI and the container smoke check, the image's title label, the internal client-IP header (`x-s10n-base-client-ip`), the server's Effect service keys, a test's temporary directory, docs |

No environment variable carries the base's name any more: phase 3 removed the last (`S10N_BASE_PORT`), and the only mention left, a line in `docs/setup.md`, went to the changelog. Among tool configs only `tsdown.config.ts` and `knip.jsonc` name the scope; tsconfig, Vitest, dependency-cruiser, ESLint, Metro and the Dockerfile do not, so section 6's list overstated it. The generated iOS project name follows the display name through the variant table; it is not a tracked file.

**What it leaves alone:** `plans/`, `CHANGELOG.md`, `docs/adr/`, `docs/new-project.md` (a guide to the base, which names it on purpose and is deleted once a project is set up), `scripts/rename/` (its rules and fixtures are the base's names), binary files, third-party names, the README's credit (which names only the upstream project), and every third-party entry in `bun.lock`.

**How it runs:** values checked first, every problem at once (exit 2); refuses a working tree with changes (a dry run is allowed, since it writes nothing) and a repository whose `package.json` is no longer named `s10n-base` (exit 1); rewrites the files; runs `bun install`, then `bun run fmt`; compares the lockfile's third-party `name@version` set before and after, failing on any difference; searches every tracked file outside the kept ones for `s10n` or `app-scaffold` in any case, failing on any hit; then prints the steps that remain (section 7's list). `--dry-run` prints every file with its replacements per rule and writes nothing.

**What the proof found,** each fixed before it passed: the renamed copy failed `fmt:check` in ten files, because names of another length re-flow Markdown tables and wrapped lines and re-sort `package.json` keys (the rename now runs the formatter), and failed one test that required bundle identifiers under `com.example.` (it now checks the variant table's shape, which holds before and after a rename). One more run failed on a lint error in the rename's own new test, which the proof caught as it should.

**The rename proof, run locally** with the sample names `Acme Notes`, `@acme`, `acme-notes`, `com.acme.notes`, `acmenotes` and cookie prefix `acme` (every form different, so a rule that used the wrong one shows): see "Verification on the final commit" below.

### Departures from this plan, with reasons

- **The lockfile's root workspace name is corrected in the base,** not left for the rename: `bun.lock` named it `app-scaffold`, the scaffold's name before publication, while `package.json` says `s10n-base`. bun accepts either with a frozen install and never rewrites the field. With the base consistent, one slug rule covers it.
- **The rename rewrites `bun.lock`'s workspace names itself before `bun install`,** rather than leaving the lockfile wholly to bun. Tried in a clone: after renaming only the manifests, `bun install` rewrote the workspace packages' names but kept the root workspace's old name. Third-party entries are never touched, and the version comparison proves it.
- **The rename also runs the formatter,** which section 6 did not list; without it no renamed copy passes `fmt:check`.
- **The kept files include `docs/new-project.md` and `scripts/rename/`,** which section 6's list could not name before they existed.
- **"Refuses to run twice"** is decided by the root `package.json`'s name, the one name every rename changes.
- **Four test temporary directories named with a bare `s10n-`** (a fifth spelling of the base's name) now use neutral prefixes, rather than adding a rule for them.
- **The docs check** (section 9, item 5) covers more than the three files: every `bun run` name, relative link and anchor in the README, `AGENTS.md`, every doc, the plans index, the project notes and the changelog must exist (a root script in the files that tell someone what to run at the root, a root or workspace script elsewhere). Repository paths in code spans are checked in the README, `AGENTS.md`, `docs/new-project.md` and the project notes. Each kind was seen to fail on a planted error.
- **Decision records are numbered `NNN`,** like the plans, so one tested module checks both indexes.
- **The changelog's dependency detail is condensed** to what a port needs (what was added, the overrides); the exact versions stay in each plan's "How it was built".

### Docs corrected (section 7)

- `docs/i18n.md`: said the mobile app was "phase 6" and that the hard-coded-string rule would come in phase 7 ("until then"); named `apps/web/src/lib/errors.ts`, which does not exist (the message keys come from `errorMessageKey` in `@s10n-base/client/messages`); said the mobile app "will pass" the device's locales, which it does.
- `docs/auth.md`: said mobile screens "arrive in phase 6" and native passkeys were "an open item for phase 6"; described the lost-response handling as the web app's only, though the mobile app runs its security actions the same way. Now also links the decision records.
- `docs/quality.md`: counted four CI jobs; listed the checks outside `agent:check` without the mobile export; said `bun run lint` runs "the first three" of a table whose first row is now the attribution gate.
- `docs/setup.md`: still mentioned `S10N_BASE_PORT`, removed in phase 3; its description of `agent:check` left out the attribution gate.
- `docs/mobile-dev.md`: told Linux developers to run four checks by hand rather than `agent:check`; called the variant names placeholders without saying the rename replaces them.
- `docs/dependencies.md` and `docs/deployment.md`: pointed at plan 000's decision table; now at the records.
- `docs/mobile-first-boot.md`: its last step now also updates the plans index.
- `plans/004-auth.md`, `005-web-blank-slate.md`, `006-mobile-blank-slate.md`: each said its final verification was "below", and nothing followed; it is in the pull request description.
- Checked and still true: `docs/client.md` (every export and function it names), `docs/deployment.md`'s tables (tested against the code), the coverage exclusion table in `docs/quality.md`, the hold list in `docs/dependencies.md`, and the health check and image details.
- `README.md` rewritten; `CUSTOMIZATION_GUIDE.md` deleted; `docs/README.md` and `docs/new-project.md` new; `CHANGELOG.md` organised by area.

### The two leftovers (section 2)

- **The dry run's empty temporary directory:** the directory was made before `git worktree add`, outside the `try`. It is now removed when git refuses, with a test that the path is gone.
- **The Vite warning:** `apps/web/vite.config.ts` imports `./src/config.ts` with its extension, and the web tsconfig allows `.ts` extensions (with `noEmit`, which its `typecheck` already passed), as the mobile app's does. No behaviour change; the build also passes with Vite's native config loader (`--configLoader native`).

### Claims in plans 000 to 009 that did not hold

- Plan 000, phase 9: the rename covers far more than "package scope, env var prefix, cookie prefix, URL schemes, bundle ids, page title", and there was no env var prefix left to rename.
- Plan 009, section 6: tsconfig, Vitest, dependency-cruiser, ESLint, Metro and Docker do not name the scope.
- Plans 004 to 006: "see below" for their verification (above).
- Plan 002 noted `bun install` does not rewrite the root workspace's name; still true, which is why the rename rewrites it.

### Open item found in review

**Done:** fixed by [plan 010](010-recheck-session-in-profile-update.md) on the same pull request, which also removed the exception from `AGENTS.md`.

Codex's automatic pass on `b4f1c44` found that `profile.update` (phase 5) breaks a rule `AGENTS.md` now states: it writes the name through Better Auth's internal adapter with only the user id, after the dispatcher's one session lookup, so a session revoked while the request runs (for example while the update waits on a row lock) can still change the name. The finding is right. It is **not fixed here**: a fix carries the session into the RPC actor and rechecks it under a row lock inside the same transaction as Better Auth's write, keeping its hooks, which changes auth behaviour across the dispatcher, the actor, the handler and the live tests; section 2 rules out behaviour changes in this phase, and it is the owner's decision whether and how to make it. `AGENTS.md` says that this handler does not meet the rule yet, so the rule is not weakened and the document stays true of the code. Proposed as a small follow-up plan.

### Verification on the final commit (section 9)

Run on 2026-11-20 on `f51fc18`; the commits after it change only this plan.

1. **From clean:** a fresh clone, `bun install --frozen-lockfile` (857 packages, lockfile unchanged), then `bun run agent:check`: all eleven gates pass, the attribution gate first (136 commits checked). Coverage 100% in all four columns: statements 4527/4527, branches 2321/2321, functions 1241/1241, lines 4047/4047, the new scripts included; 1726 tests in 119 files (23 skipped: the path check of `doc-references.test.ts`, which runs only for the four root-level docs). No new suppression, no new coverage exclusion (`scripts/**/*.main.ts` covers the four new entries), no raised limit.
2. **Locally** on `891a89f` (the commits after it change docs, plans and one test title): `build`, `db:up`, `db:migrate`, `db:generate:check`, `test:live` (57 tests in 11 files), `smoke`, `mobile:export` (one React in both bundles), `docker:build` and `docker:smoke` (394.1 MB, 63 run-time packages, every check passing, exit 0 on `SIGTERM` after 333 ms) and `test:e2e` (both journeys) pass.
3. **The rename proof** on `f51fc18`, with the sample names `Acme Notes`, `@acme`, `acme-notes`, `com.acme.notes`, `acmenotes` and cookie prefix `acme`: the rename changed 128 files, `bun install` moved no package version, the formatter ran, and its own leftover search found nothing. In the renamed copy: frozen install passed (875 installs, no changes); `agent:check` passed, every gate, coverage 100% (4527 statements, 2321 branches); `build` passed (4 tasks); `mobile:export` passed (one React in each bundle). **Leftover search:** "found nothing outside the kept files". CI's fifth job runs the same proof on every push.
4. **The attribution check** fails on a planted commit and through the hook in a throwaway clone, and passes on this branch (section "The commit-attribution check" above).
5. **Commands and paths:** `doc-references.test.ts` checks every `bun run` name, relative link and anchor in the README, `AGENTS.md`, the docs, the plans index, the project notes and the changelog, and every repository path named in the README, `AGENTS.md`, `docs/new-project.md` and the project notes; each kind was seen to fail on a planted error. By hand: every command in the README's table and the new-project guide's steps was run during this phase, except `bun run ios:simulator` (no Mac), `bun run android` (no Android SDK), `bun run hooks:install` (run only in a throwaway clone, so this checkout's hooks are unchanged) and `bun run deps:update --dry-run` (unchanged since phase 8).
6. `git grep -niE 'electron|desktop|CUSTOMIZATION_GUIDE|EXTRACTION_REPORT|vitest\.workspace|sqlite|websocket|S10N_BASE_HOME|dist-electron'` outside `plans/`, `CHANGELOG.md` and `bun.lock` finds only third-party names: Docker Desktop in `docs/setup.md`, Playwright's "Desktop Chrome" device, and the word "electronic" in the AWS test suite's licence. No doc links a doc that does not exist (the docs check).
7. **CI:** recorded in the pull request description for the head commit; all five jobs.
8. **Scrub:** the plan 000 check prints nothing, run before every push, and the commit messages and the pull request description were read against the same list. The decision records and the README had a second read; it corrected two records that misstated what the three projects use (`docs/adr/002`, `003`), and found nothing that describes a project.
