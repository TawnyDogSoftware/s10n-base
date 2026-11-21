# 013: Holds that follow another package

> Status: in progress.

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

Not built yet.
