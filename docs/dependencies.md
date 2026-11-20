# Dependencies

How versions are chosen, where each one lives, and how they are kept current.

## The 3-day rule

Every package and tool is on the newest stable release that is at least 3 days old. A release that turns out to be broken or malicious is usually pulled or fixed within that time.

Where the rule is enforced:

- **bun packages:** `bunfig.toml` sets `[install] minimumReleaseAge = 259200` (seconds). bun 1.4.4 applies it to `bun install`, `bun add`, `bun update` and `bun update --latest`, and to indirect dependencies as well as direct ones. A version that is too young is skipped in favour of the newest one that is old enough.
- **bun and Node:** the daily update workflow takes the newest release at least 3 days old (below).
- **GitHub Actions:** Dependabot, with `cooldown.default-days: 3` in `.github/dependabot.yml`.
- **Container base images:** the daily update moves the Node and bun images' tags with Node and bun; Dependabot (same cooldown) refreshes the digest a pinned tag points to when the image is rebuilt, for example for a security fix in the base.

Two packages are deliberately behind the newest release: TypeScript and React. The reasons are in `dependency-holds.json` and in decision records [004](adr/004-lint-stack.md) and [006](adr/006-toolchain.md).

## Where each version lives

| What     | Where                                       | Read by                                                                                                   |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node     | `.nvmrc` (exact version)                    | `engines.node` (`>=` that version), CI and the update workflow through `setup-node`'s `node-version-file` |
| bun      | `packageManager` in the root `package.json` | `engines.bun`, CI and the update workflow through `setup-bun`'s `bun-version-file`                        |
| Packages | the `catalog` in the root `package.json`    | workspace manifests, through `catalog:`                                                                   |

`@types/node` stays on Node's major version. `scripts/version-sources.test.ts` fails if `.nvmrc`, `engines`, `packageManager` and `@types/node` disagree. No workflow file names a version, so the update workflow never edits a workflow.

`docker/Dockerfile` is the one exception: a `FROM` line cannot read a file, so it names both versions itself, in the Node and bun images' tags (each pinned by digest) and in the build step that checks them. The same test fails when those disagree with `.nvmrc` and `packageManager`, or a base image has no digest (`scripts/dockerfile-versions.ts`). The daily update moves them together: when Node or bun moves, it rewrites the Dockerfile's tag, digest and check in the same PR, looking each new tag's digest up in the image registry's public API. Each `FROM` line keeps its own variant (`-slim`, `-alpine`), with that tag's digest. If any new tag of a runtime cannot be found yet, that runtime does not move that day, and the PR body says why. Dependabot's `docker` entry ignores version updates of the two images and only refreshes digests.

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

## Expo and the 3-day rule

Expo owns the versions of React, React Native and every native module. Add or move them only with `bunx expo install` in `apps/mobile`. By default `expo install` asks Expo's servers for the SDK's newest patch versions, which can be younger than 3 days, and bun then refuses them (`blocked by minimum-release-age`). Use the installed SDK's own version map instead, which the gate already allowed:

```bash
cd apps/mobile
EXPO_OFFLINE=1 bunx expo install <package>
EXPO_OFFLINE=1 bunx expo install --check   # what CI runs
```

The online `bunx expo install --check`, which the daily update runs, compares with Expo's newest patches and reports them as drift until they are old enough; moving `expo` itself to a newer patch brings its newer version map with it. On 2026-11-19 it reported `expo` 58.0.26, `expo-dev-client` 58.0.21, `expo-router` 58.0.32 and `expo-web-browser` 58.1.0, all published on 2026-11-17 and allowed from 2026-11-20.

## Overrides

`overrides` in the root `package.json` forces one version of a package everywhere in the tree. Each entry needs a reason, kept here:

- `effect`: one copy of Effect for every workspace and dependency, so its schemas and errors are the same classes everywhere.
- `minimatch` `^11.0.8`: Expo's `@expo/fingerprint` 0.21.10 and `eslint-plugin-sonarjs` 4.2.2 ask for `^10.2.6`, and 10.x has a moderate advisory (GHSA-g3hv-75wg-m249, denial of service through glob pattern amplification, fixed in 11.0.1). The fingerprint of `apps/mobile` is the same with 11.0.8 as with 10.2.6. Remove the override when both move to 11.

## The hold list

`dependency-holds.json` lists the packages the daily update must not move freely. Each entry has `packages` (names, or patterns with `*`), a `reason`, and optionally:

- no `range` or `group`: never updated by the workflow. Change these by hand.
- `range`: moves only inside it, for example `<6.1.0` or `0.29.x`.
- `group`: the members move only when they all land on the same version; otherwise all of them stay.

Each place a held package is declared (the catalog, or a workspace's own dependency list) is checked and put back on its own, and a group's members are compared wherever they are declared. A file without a `holds` list fails the update rather than lifting every hold.

A package that must stay keeps its locked version too, not just its spec: `bun update --latest` may lock a newer version that the old spec still allows (a `~` spec and a patch release), and bun keeps a locked version that satisfies the spec. So the update pins such a package to its earlier version, installs, then puts its spec back. A package held to a `range` may move inside it: when the update takes it past the range, only its spec is put back, and bun resolves it again to the newest release that spec and the 3-day rule allow (checked with bun 1.4.4, plan 011).

Entries can name packages that are not installed yet; they apply from the day the package arrives. `scripts/dependency-updates/holds.test.ts` fails if an entry has no reason, if a held package in the catalog or lockfile is outside its range, or if members of a group are on different versions.

The current entries:

- `react`, `react-dom`, `react-native`, `react-native-*`, `expo`, `expo-*`, `@expo/*`: owned by the Expo SDK. Move them with `bunx expo install` when the SDK moves, so web and mobile resolve one React.
- `@types/react`, `@types/react-dom`: inside `~19.3.0`, with React.
- `typescript`: below 6.1, because typescript-eslint supports nothing newer.
- `better-auth`, `@better-auth/expo`, `@better-auth/passkey`: one group, always on one version.
- `better-call`: must equal the exact version `better-auth` depends on, which is a different number from better-auth's own version, so it cannot be in the group. Change it by hand whenever the group moves; `holds.test.ts` fails when it differs from the version in `better-auth`'s own manifest (as recorded in `bun.lock`), and when the group is not pinned exactly. The route guard uses it directly (see `docs/auth.md`).
- `kysely`: `0.29.x`, the range Better Auth supports.

To change a hold, edit the file and run `bun run test`.

## The daily update PR

`.github/workflows/dependency-updates.yml` runs `bun run deps:update` every day at midnight UTC (GitHub may start it later at busy times) and can be started by hand from the Actions tab. Each run:

1. Finds the open PRs labelled `dependency-update` whose branch is a `deps/update-YYYY-MM-DD` branch of this repository and whose base is `main`. A labelled PR that is not like that is logged and left alone. It builds on the newest; an older one, which an interrupted run can leave open, is closed in favour of the newest.
2. Starts from that PR's branch with `main` merged in, so fixes already pushed there carry forward. If the merge conflicts, or there is no open PR, it starts from `main`, and the PR body says when a conflict forced that.
3. Runs `bun update -r --latest`, which moves every package to its newest release at least 3 days old, across major versions, keeping exact pins exact. bun's named and negated filters (`bun update typescript`, `bun update '!typescript'`) do not rewrite catalog entries, so the script updates everything, puts held packages back to their earlier spec, and reinstalls.
4. Moves bun and Node to their newest releases at least 3 days old (Node on its current LTS major), and keeps `@types/node` on that major. A newer Node LTS major is reported, not applied.
5. Runs `bunx expo install --check` in `apps/mobile` (online, against Expo's newest SDK patches) and reports drift in the PR body, or that the check could not run (no network, a crash) when it fails without naming a package. It does not apply drift: move Expo packages with `bunx expo install`.
6. If no file changed, stops and leaves the open PR alone, with two repairs for a run that was interrupted: it closes older update PRs, and when the PR's body names a commit other than the PR's head (the push landed but the body edit failed), it rewrites the body. Each body ends with a hidden line naming the commit it describes; a body without that line is never rewritten. Otherwise it commits, pushes `deps/update-YYYY-MM-DD` (UTC date) and opens a PR with the label. If the open PR is already on today's branch, it pushes there (with a lease, since after a conflict the new commit does not descend from the old one) and updates the body instead; otherwise it comments on the old PR with a link to the new one, closes it and deletes its branch.

The PR body describes everything the PR changes against `main`, including updates carried over from the PR it supersedes: direct dependency changes as major, minor and patch, direct dependencies added or removed, indirect dependencies that moved in, came into or left `bun.lock`, bun and Node changes, what was reported but not applied (held packages, a new Node LTS line, Expo drift), and the releases `bun outdated` shows as held back by the 3-day rule.

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
