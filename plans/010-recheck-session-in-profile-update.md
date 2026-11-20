# 010: Recheck the session inside the profile update

> Status: in progress since 2026-11-20, on `feature/001-strip-desktop-and-local-first` (pull request #1).

A follow-up to [005](005-web-blank-slate.md) and [009](009-conventions-and-docs.md), on the same pull request as the rework ([000](000-hosted-starter-rework.md)).

## 1. Why

`docs/auth.md` and `AGENTS.md` state a rule our projects learned from review: a handler that acts on a session's authority inside a transaction rechecks that session inside the same transaction. The one handler in the base that writes on a session's authority, `profile.update`, does not. A session revoked while the request is in flight (a sign-out elsewhere, a password reset, an admin action) can still change the name. Review found this during phase 9, which could not fix it because it changes auth behaviour; `AGENTS.md` currently names the handler as an exception to its own rule.

The harm is small (a display name), but this is a starter: the first write handler is the one every project will copy. It should show the rule being followed, with a helper the next handler can reuse.

## 2. Scope

In scope: the recheck, a reusable helper for it, its tests, and removing the exception from the docs. One unrelated tidy: `scripts/doc-references.test.ts` registers tests with `it.runIf`, so every run reports 23 skipped tests. Restructure it so only the cases that apply are registered and the run reports none skipped; the checks themselves must not weaken.

Out of scope: any other change to auth behaviour, sessions, cookies or the dispatcher's order of checks; any new dependency.

## 3. What must be true afterwards

1. **One transaction:** `profile.update` performs its write and the session recheck in a single database transaction.
2. **Lock, then look:** the transaction first locks the caller's session row, then reads the time, then checks that the session exists and has not expired. The clock is read after the lock is held, never before (the first pitfall in `docs/auth.md`).
3. **Revoked means refused:** if the session is gone or expired at that point, nothing is written and the call fails with `auth.unauthenticated`, the same error an anonymous caller gets. The client's existing handling of that error (re-read the session, treat as signed out) then applies with no client change.
4. **A banned user is refused** the same way, if the base's session lookup already treats a banned user as anonymous (plan 004 says it does). Check, and keep the two consistent.
5. **Better Auth stays consistent:** after a successful update, the session route and Better Auth's own view of the user show the new name at once, as they do today (plan 005 section 4). If the write currently goes through Better Auth's API, find a way to keep both this property and the single transaction; say which approach you took and why.
6. **Reusable:** the recheck is a small helper that a future write handler calls in one line, with the actor carrying what it needs to identify the session. The dispatcher still resolves the actor lazily, and a `public` method still costs no session query.
7. **Read handlers are unchanged.** `profile.get` and `admin.listUsers` do not take the lock.

## 4. Tests, written first

- **Unit:** the helper's branches (present, missing, expired, banned), and that the clock is read after the lock (a fake clock and a fake transaction that record the order).
- **Live, the race itself, made deterministic:** start `profile.update`, hold it at a point after the dispatcher has authorised the call and before the write (a test-only hook or a second connection holding a lock, not a sleep), revoke the session from another connection and commit, release. Assert the call fails with `auth.unauthenticated` and the name in the database is unchanged. Before the fix, this test must fail by changing the name; show that.
- **Live, the other order:** a revocation that commits after the update's transaction leaves the new name in place and the next call unauthenticated.
- **Live, expiry:** a session whose expiry passes while the request waits for the lock is refused.
- **Existing tests** for `profile.update`, the session route and the web and mobile profile screens keep passing unchanged.

## 5. Docs

- `AGENTS.md`: remove the exception; the rule stands without one.
- `docs/auth.md`: the pitfall section points at the helper as the worked example, with how to use it in a new handler.
- `CHANGELOG.md`: a line in the rework's section.
- `plans/README.md`: this plan in the index. `plans/009-conventions-and-docs.md`: its follow-up note marked done.
- The pull request description: add a short `## Follow-up: plan 010` section after `## Phase 9`, and remove the "decide on one review finding" item from "Needs the owner".

## 6. Verification and definition of done

On the final commit, recorded in section 7 and the PR description:

1. From clean: frozen install, `bun run agent:check`: all gates, 100% coverage, and the test summary reports no skipped tests.
2. Database up: `test:live` including the new race tests, `smoke`, `test:e2e`.
3. The race test failing before the fix (the output), and passing after.
4. CI green on the head commit: all five jobs.
5. The scrub check from plan 000 prints nothing.

## 7. How it was built

Filled in by the implementor.
