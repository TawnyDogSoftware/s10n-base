# 013: Holds that follow another package

> Status: implemented on 2026-11-21, on `feature/013-follower-holds`.

A follow-up to [002](002-toolchain-upgrade-and-ci.md), which built the daily dependency update and its hold list, and to [004](004-auth.md), which pinned `better-call`.

## 1. Why

The route guard imports `better-call` itself and must match routes with the very copy Better Auth uses (plan 004, section 3). So the catalog's `better-call` must be exactly the version `better-auth` depends on, and `holds.test.ts` fails when it is not. That version has its own numbering (`better-auth` 1.7.25 pins `better-call` 1.4.5), so `better-call` cannot join the Better Auth group, whose rule is "all on one version". It was a plain hold instead: never moved by the daily update, "change it by hand when the better-auth group moves".

That makes the first update that moves the group a broken one. `better-auth` 1.7.26 and 1.7.27 pin `better-call` 1.4.6; the catalog has 1.4.5. The update moves the three Better Auth packages, puts `better-call` back to 1.4.5 as the hold says, and its pull request fails the pairing test until someone edits the catalog. A rule a person has to remember, on a pull request a workflow opens every day, is the wrong shape.

## 2. Scope

In scope: a new kind of hold for a package that follows another, the step of the update that applies it, what happens when it cannot be applied, the pull request body, the `better-call` entry, tests and docs.

Out of scope: changing the version of `better-auth` or `better-call` (the daily update does that once the rule exists); any change to the 3-day rule or a way round it; any new dependency; chains of followers.

## 3. What must be true afterwards

1. **A general rule, in the hold list.** An entry of `dependency-holds.json` can say that its packages follow another package. Nothing in the code names `better-call` or `better-auth`.
2. **Never on its own.** The update does not move a follower by itself, whatever its newest release is.
3. **Set after the update.** Once the update has run and the other holds are enforced, each follower is set to exactly the version the followed package, at the version now installed, depends on, and `bun.lock` agrees.
4. **Exact or range.** The followed package may pin its dependency exactly or declare a range; for a range the follower takes what the lockfile resolved for that dependency.
5. **No half-moved state.** If the follower's version cannot be installed, the follower, the followed package and its whole group go back to where they were, and the pull request body says so under "Reported, not applied". The update never ends with the two disagreeing, and the 3-day rule is not weakened.
6. **An honest pull request body.** The follower's move is listed like any other package's, and nothing says it "stays at" a version it left.
7. **A malformed entry is refused** by `parseHolds`, like the other kinds. A followed package that is not installed is allowed, as entries may name packages that have not arrived.

## 4. Tests, written first

Driven through the fake `Io`, as the flow's other tests are, with a fake registry that knows which release depends on what:

- the follower moves when the followed package moves, and the body lists it;
- nothing changes when the followed package did not move and the follower agrees;
- the followed package declares a range: outside it, the follower takes what was resolved; inside it, it stays;
- the follower's version cannot be installed: the group goes back, and the body says why;
- `parseHolds` refuses each malformed entry;
- the repository's own pairing test stays, and covers every follower.

## 5. Docs

`docs/dependencies.md` (the hold list, the `better-call` entry, the steps of the daily update), `docs/auth.md` and `AGENTS.md` where they say the four packages move together, the reason and `$comment` in `dependency-holds.json`, and `CHANGELOG.md`.

## 6. Verification and definition of done

1. `bun run agent:check` passes: every gate, 100% coverage.
2. Each behaviour of section 3 has a test that failed before the code existed, for the stated reason.
3. `bun run deps:update --dry-run` runs with the new rule and its output is recorded.
4. The scrub check from plan 000 prints nothing.

## 7. How it was built

Implemented on 2026-11-21 on Node 26.13.1 and bun 1.4.4, with `better-auth` 1.7.25 and `better-call` 1.4.5 installed. No dependency was added and no version was changed.

### The hold

```json
{ "packages": ["better-call"], "follows": "better-auth", "reason": "…" }
```

`follows` reads as the others do: a `range` to stay in, a `group` to move with, a package to follow. `parseHolds` refuses a `follows` that is not a non-empty string, one combined with `range` or `group` (a follower has no version of its own to bound or to agree on), and a follower of a follower, which also covers a follower of itself. The followed name need not be held or installed.

Nothing in `enforceHolds` changed. A follower has no range, so the existing rule already puts it back whenever `bun update --latest` moved it to its own newest release; that is requirement 2. The new step runs after that.

### Where the version comes from

`bun.lock`, and nothing else. The existing pairing test already read it there: each package's entry records the `dependencies` of that release's own manifest, so `better-auth`'s entry says which `better-call` it wants without asking the registry. What was found:

- **`better-auth` pins it exactly.** The published manifests of 1.7.25, 1.7.26 and 1.7.27 declare `"better-call": "1.4.5"`, `"1.4.6"` and `"1.4.6"` in `dependencies`. (`@better-auth/core`, `@better-auth/expo` and `@better-auth/passkey` name it as a peer, `~1.4.5` in 1.7.25; the rule reads `dependencies` of the one followed package.) For an exact pin the declared version is the answer, whatever the tree looks like.
- **A range needs the resolved version.** Tried with bun 1.4.4 in a scratch workspace: with the workspace on `better-call` 1.4.4 and `better-auth` 1.7.25 wanting 1.4.5, bun keeps the workspace's copy at the top level and writes the other under the key `"better-auth/better-call"`. After the workspace's spec is set to 1.4.5 and `bun install` runs, that entry is gone and one copy is left. So for a range the rule takes the entry `<followed>/<follower>` when there is one, and otherwise the top-level copy, which then already serves the range.

`resolveLockedDependency` (`lockfile.ts`) does that and returns the followed package's installed version with it, for the messages. `followerMoves` (`holds.ts`) turns it into the list of followers to move: every declared package held with `follows` whose declarations are not all exactly that version. A follower whose followed package is not installed, or does not depend on it, is not in the list.

### The step in the flow

`moveFollowers` (`flow.ts`), called at the end of `updatePackages`:

1. Asks `followerMoves` for the manifests and lockfile as the update and the holds left them. None: nothing is written and nothing installed.
2. Writes each follower's declarations as the exact version and runs `bun install --ignore-scripts`.
3. If the install fails, `restoreFollowed` builds a restoration for each declaration of the follower, the followed package and every member of its group that is not where it was before the update, with the reason "`better-call` 1.4.6, which `better-auth` 1.7.27 depends on, could not be installed (bun's first line), so `better-auth` and the packages held with it stay where they were." The existing `restore` applies them, keeping each locked version. A package whose spec stayed but whose locked version moved (a followed package held to a range) goes back too.
4. Asks `followerMoves` again. Anything left means the two disagree and could not be brought into line, which can only happen when they already disagreed before the update: the run fails there, before any commit, push or pull request.
5. Returns the restorations to report: those of the hold enforcement, without the ones for a follower that then moved (requirement 6), plus those of step 3.

The pull request body needed no change of its own. It lists changes by comparing `bun.lock` with the base, so the follower's move appears in the table for its kind, and the restorations are the lines under "Reported, not applied".

### Departures from this plan, with reasons

- **A follower that had drifted is corrected**, even when the followed package did not move. The rule is applied to the state, not to the move, so nothing had to be added for it. It matters at once: an update pull request opened before this change, with the Better Auth group moved and `better-call` behind, is repaired by the next run on its branch.
- **A run can now fail on a disagreement it cannot repair** (step 4). Requirement 5 says the update never ends with the two disagreeing; when there is no earlier state to return to, failing is the only way to keep that.
- **All followers are installed in one `bun install`,** and when it fails all of them, with their followed packages, go back. Finding which one bun refused would mean one install per follower for a case with one follower today.
- **Chains are refused** rather than ordered: a follower of a follower is an error in `parseHolds`.
- **`docs/auth.md`** also said a person moves the four packages; it now says the update sets `better-call`.

### Tests, each failing first

Written before the code, 26 in all.

- **`lockfile.test.ts`, `holds.test.ts`:** 17 failed on the first run, 16 because `resolveLockedDependency`, `followerMoves` and `restoreFollowed` did not exist or `parseHolds` accepted the malformed entry, and the repository's own test (below). They cover the exact pin, a range outside and inside the top-level copy, a scoped parent, the three "nothing to follow" cases, a follower declared in two places, the group and the no-group restoration, and each refusal of `parseHolds`. One passed from the start, on purpose: `enforceHolds` already never lets a follower move on its own.
- **The repository's own test** ("keeps every follower on exactly the version the package it follows depends on") failed with `expected [] to deep equally contain { name: 'better-call', followed: 'better-auth' }` until `dependency-holds.json` changed. It checks every follower in the catalog, and that the followed package still depends on it. The `better-call` test from plan 004 is kept unchanged.
- **`flow.test.ts`,** through the fake `Io`, which now models a registry (which release depends on what, what a range resolves to, which release is too young) and writes `bun.lock` the way bun does. Five failed first:
  - _moves the follower_: the catalog was left with `auth` 1.7.26 and `auth-router` 1.4.5, the half-moved state;
  - _follows what the lockfile resolved_ (a range): the same, 1.4.5 instead of 1.5.2;
  - _puts the followed package and its group back_: `auth` stayed on 1.7.26;
  - _brings a drifted follower back into line_: it stayed on 1.4.4;
  - _fails the run when nothing can bring them into line_: `promise resolved "{ kind: 'unchanged' }" instead of rejecting`.

  Three passed from the start, because they state what must not change: the followed package did not move, no package moved at all, and a range that accepts the follower's copy. They would fail if the step moved a follower it should leave.

### Verification (section 6)

1. **`bun run agent:check`** passed every gate: 2,014 tests in 124 files, none skipped; coverage 100% of statements (5,194), branches (2,708), functions (1,437) and lines (4,627).
2. **Failing first:** above.
3. **The dry run,** `bun run deps:update --dry-run --from HEAD` on 2026-11-21 at about 22:50 UTC. It started from the open update pull request's branch with this branch merged in, ran `bun update -r --latest` and the hold enforcement, and ended "Nothing to update: no file changed on top of the starting point." `better-call` was not moved: the installed `better-auth` 1.7.25 depends on 1.4.5, which it is on (its own newest release, 1.4.6, was refused by the hold as before). The Better Auth group did not move: `bun outdated` showed 1.7.25 as the newest release the 3-day rule allows for all three. That is worth knowing: 1.7.26 was published on 2026-11-18 at 17:54 UTC, more than three days before, and bun 1.4.4 still did not offer it while 1.7.27 (2026-11-20) was inside the window. Why was not looked into.
4. **A rehearsal with the real bun,** since the dry run above had nothing to follow: a throwaway commit, on no branch, with `better-call` set to 1.4.4, then `deps:update --dry-run --from <that commit>`. `bun update` moved it to 1.4.6, the hold put it back to 1.4.4, and the new step logged "better-call follows better-auth 1.7.25: set to 1.4.5." The body it printed lists `| better-call | 1.4.4 | 1.4.5 |` under Patch and has no "better-call stays at" line. Nothing was pushed.
5. **The scrub check** from plan 000 printed nothing.

Not verified with the real bun: the group really moving (no release is allowed yet), and the path where the follower's version cannot be installed, which needs a follower release inside the 3-day window. Both are covered through the fake `Io` only; bun's refusal message in that test is copied from a real refusal of an exact, too-young version.

### For later work

- If `better-auth` ever stops listing `better-call` in `dependencies` (a peer only, say), the follower is left where it is and the repository's test fails on that update's pull request. The hold then needs rethinking, not the code.
- The rule reads bun's text lockfile: the `<parent>/<name>` key for a package's own copy. A bun release that writes it otherwise would only affect followed packages that declare a range; the exact pin does not depend on it.
