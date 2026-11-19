# Dependencies

How versions are chosen, where each one lives, and how they are kept current.

## The 3-day rule

Every package and tool is on the newest stable release that is at least 3 days old. A release that turns out to be broken or malicious is usually pulled or fixed within that time.

Where the rule is enforced:

- **bun packages:** `bunfig.toml` sets `[install] minimumReleaseAge = 259200` (seconds). bun 1.4.4 applies it to `bun install`, `bun add`, `bun update` and `bun update --latest`, and to indirect dependencies as well as direct ones. A version that is too young is skipped in favour of the newest one that is old enough.
- **bun and Node:** the daily update workflow takes the newest release at least 3 days old (below).
- **GitHub Actions:** Dependabot, with `cooldown.default-days: 3` in `.github/dependabot.yml`.

Two packages are deliberately behind the newest release: TypeScript and React. The reasons are in `dependency-holds.json` and in plan 000 (decisions D4 and D6).

## Where each version lives

| What     | Where                                       | Read by                                                                                                   |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node     | `.nvmrc` (exact version)                    | `engines.node` (`>=` that version), CI and the update workflow through `setup-node`'s `node-version-file` |
| bun      | `packageManager` in the root `package.json` | `engines.bun`, CI and the update workflow through `setup-bun`'s `bun-version-file`                        |
| Packages | the `catalog` in the root `package.json`    | workspace manifests, through `catalog:`                                                                   |

`@types/node` stays on Node's major version. `scripts/version-sources.test.ts` fails if `.nvmrc`, `engines`, `packageManager` and `@types/node` disagree. No workflow file names a version, so the update workflow never edits a workflow.

## Taking a bug-fix release early

Only when a release fixes a bug that affects this repo. Otherwise wait: the daily update takes it once it is 3 days old.

1. Add the package to `minimumReleaseAgeExcludes` in `bunfig.toml`, with a comment naming the bug and the date the release turns 3 days old, which is when the entry must be removed:

   ```toml
   [install]
   minimumReleaseAge = 259200
   # vitest 5.1.1: <bug and link>. Remove on 2026-11-21.
   minimumReleaseAgeExcludes = ["vitest", "@vitest/coverage-v8", "@vitest/mocker", "@vitest/spy"]
   ```

2. Change the catalog entry and run `bun install`.
3. Check `bun.lock` contains the new version of every package you listed.

The exclusion covers only the packages named, never their dependencies. bun 1.4.4 behaves like this:

- If the release depends on packages published with it, the install fails with `blocked by minimum-release-age` until you list them too, one error at a time. For example `@tanstack/react-query` needs `@tanstack/query-core`, and `vitest` 5.1.1 needs `@vitest/mocker` and `@vitest/spy`.
- Packages that ship native binaries as optional dependencies (`oxlint` and its `@oxlint/binding-*`, `turbo` and its `@turbo/*`, `rolldown`) are worse: bun skips the blocked binaries **without an error**, so the install looks fine but leaves no binary for the new version. List every platform package by its full name; patterns such as `@oxlint/*` are not supported.

For a one-off command, `--minimum-release-age-excludes=<name>` does the same and replaces the `bunfig.toml` list for that command.

## The hold list

`dependency-holds.json` lists the packages the daily update must not move freely. Each entry has `packages` (names, or patterns with `*`), a `reason`, and optionally:

- no `range` or `group`: never updated by the workflow. Change these by hand.
- `range`: moves only inside it, for example `<6.1.0` or `0.29.x`.
- `group`: the members move only when they all land on the same version; otherwise all of them stay.

Entries can name packages that are not installed yet; they apply from the day the package arrives. `scripts/dependency-updates/holds.test.ts` fails if an entry has no reason, if a held package in the catalog or lockfile is outside its range, or if members of a group are on different versions.

The current entries:

- `react`, `react-dom`, `react-native`, `react-native-*`, `expo`, `expo-*`, `@expo/*`: owned by the Expo SDK. Move them with `bunx expo install` when the SDK moves, so web and mobile resolve one React.
- `@types/react`, `@types/react-dom`: inside `~19.3.0`, with React.
- `typescript`: below 6.1, because typescript-eslint supports nothing newer.
- `better-auth`, `@better-auth/expo`, `@better-auth/passkey`: one group, always on one version.
- `better-call`: must equal the exact version `better-auth` depends on, which is a different number from better-auth's own version, so it cannot be in the group. Change it by hand whenever the group moves.
- `kysely`: `0.29.x`, the range Better Auth supports.

To change a hold, edit the file and run `bun run test`.

## The daily update PR

`.github/workflows/dependency-updates.yml` runs `bun run deps:update` every day at midnight UTC (GitHub may start it later at busy times) and can be started by hand from the Actions tab. Each run:

1. Finds the open PR labelled `dependency-update`, if there is one.
2. Starts from that PR's branch with `main` merged in, so fixes already pushed there carry forward. If the merge conflicts, or there is no open PR, it starts from `main`, and the PR body says when a conflict forced that.
3. Runs `bun update -r --latest`, which moves every package to its newest release at least 3 days old, across major versions, keeping exact pins exact. bun's named and negated filters (`bun update typescript`, `bun update '!typescript'`) do not rewrite catalog entries, so the script updates everything, puts held packages back to their earlier spec, and reinstalls.
4. Moves bun and Node to their newest releases at least 3 days old (Node on its current LTS major), and keeps `@types/node` on that major. A newer Node LTS major is reported, not applied.
5. Runs `bunx expo install --check` in `apps/mobile` when that app exists and reports drift.
6. If no file changed, stops and leaves any open PR alone. Otherwise it commits, pushes `deps/update-YYYY-MM-DD` (UTC date) and opens a PR with the label. If the open PR is already on today's branch, it pushes there (with a lease, since after a conflict the new commit does not descend from the old one) and updates the body instead; otherwise it comments on the old PR with a link to the new one, closes it and deletes its branch.

The PR body describes everything the PR changes against `main`, including updates carried over from the PR it supersedes: direct dependency changes as major, minor and patch, indirect dependencies that moved in `bun.lock`, bun and Node changes, what was reported but not applied (held packages, a new Node LTS line, Expo drift), and the releases `bun outdated` shows as held back by the 3-day rule.

**When a major update breaks CI,** fix it on the PR's branch, by hand or with an agent, and merge the PR with the fix. The next day's run starts from that branch, so the fix is kept.

**Trying it locally:** `bun run deps:update --dry-run` does the whole update in a temporary git worktree (your checkout is not touched) and prints the PR body and the push and `gh` commands it would have run. Reads such as `gh pr list` still run. `--from <ref>` starts from that ref instead of `origin/main`, for trying a branch; it uses committed files only.

**Public repositories:** GitHub disables scheduled workflows in a public repository after 60 days without repository activity. Merging the update PRs counts as activity. After a long quiet spell, re-enable the workflow from the Actions tab.

## Setting up the GitHub App

The workflow writes with a GitHub App installation token, because a PR opened with the default `GITHUB_TOKEN` does not trigger CI. The job's own token stays read-only.

1. Create a GitHub App owned by the organisation. No webhook. Repository permissions: **Contents: read and write** and **Pull requests: read and write**. Nothing else (Metadata: read is added automatically).
2. Install it on the repositories that run the workflow.
3. Generate a private key.
4. Add two secrets, at organisation level limited to the selected repositories (a repository created from a template copies workflows but not secrets):
   - `DEPS_UPDATE_APP_CLIENT_ID`: the app's Client ID.
   - `DEPS_UPDATE_APP_PRIVATE_KEY`: the private key file's contents.

Without both secrets the job ends successfully with a notice saying what to configure, so a new project or a fork does not fail every night. The workflow never prints the key or the token. The first run creates the `dependency-update` label if it does not exist.
