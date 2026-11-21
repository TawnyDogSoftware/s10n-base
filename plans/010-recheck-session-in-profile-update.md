# 010: Recheck the session inside the profile update

> Status: implemented on 2026-11-20, on `feature/001-strip-desktop-and-local-first` (pull request #1).

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

Implemented on 2026-11-20 on the rework's pull request (#1), on Node 26.13.1, bun 1.4.4 and Better Auth 1.7.25, with Docker for the local Postgres. No dependency was added.

### The helper

`sessionTransaction` (`apps/server/src/rpc/session-transaction.ts`) is built once in `server.ts` and reaches handlers through `RpcHandlerDependencies`. A handler calls it in one line:

```ts
defineHandler(profileUpdate, ({ name }, context) =>
  sessionTransaction(context, async (_trx, caller) =>
    profileFromUser(await auth.updateUserName(caller.userId, name)),
  ),
),
```

It takes the caller from `context.getActor()` (already resolved by the dispatcher, so no second lookup), opens a transaction, and in it:

1. **Locks** the caller's session row: `select "id" from "ba_session" where "id" = $1 and "user_id" = $2 for update`.
2. **Reads the clock** (an injected `now`, the system clock by default).
3. **Reads** the session's `expires_at` and its user's `banned` and `ban_expires`, in a statement of its own.
4. Runs the work if `sessionGrants` says the session still holds: it exists, `expires_at` is not before now (Better Auth's own test in `getSession`), and the user is not banned by `isBanned`, the function the session lookup uses. Otherwise it throws `RpcFailure(401, "auth.unauthenticated", "Sign in to use this method.")`, the dispatcher's own answer to an anonymous caller, the transaction rolls back and the work never runs.

Plan 004 is right that the lookup treats a banned user as anonymous (`sessionOf`); the recheck uses the same function, so the two agree (requirement 4).

**Lock and read are two statements on purpose.** A single `select … join ba_user … for update of ba_session` re-reads the locked session row once the lock is granted, but Postgres keeps the joined user row as the statement first saw it, so a ban committed while the request waited went unseen. Tried that way, the live ban test failed by changing the name; with the read as its own statement (a new snapshot under read committed) it passes. Moving the clock read above the lock likewise makes the live expiry test fail.

**The actor** carries `sessionId`, the id of the session row. `AppAuth.getSession` returns `{session, sessionId}` (`signedInOf` in `auth/instance.ts`), and the actor resolver copies the id. The id, not the token, since the token is the secret in the cookie. The dispatcher is unchanged: it still resolves the actor lazily and at most once, and a `public` method still costs no session query. `profile.get` and `admin.listUsers` take no lock; a unit test checks `profile.get` runs no session transaction and no `for update`. The session route uses `readSession`, which is unchanged.

### Keeping Better Auth's write in the transaction (requirement 5)

`profile.update` wrote through `internalAdapter.updateUser`, so Better Auth's hooks run and its secondary storage is refreshed (plan 005). Three ways to put that write and the lock in one transaction were weighed:

- **A direct `UPDATE ba_user` in our transaction.** The same result today (no cookie cache, no secondary storage, and no user update hooks in the options or the three plugins), but a project that adds any of them would lose them without a failing test. Not taken.
- **Better Auth's own transaction.** `runWithTransaction` makes the internal adapter use a transaction adapter, but 1.7.25 exports it only from `@better-auth/core/context`, which the server does not declare (it would be a new dependency), and its adapter interface has no way to take a row lock in that transaction. Not taken.
- **Better Auth's queries join our transaction. Taken.** `joinableTransactions(db)` (`apps/server/src/infra/postgres/transactions.ts`) returns `transaction(work)` and `joinable`, a `Proxy` over the pool's Kysely. While `work` runs, `joinable` resolves to the open transaction in that async context (`AsyncLocalStorage` from `node:async_hooks`); anywhere else it is the plain database. Better Auth's options get `joinable` instead of the pool's Kysely, and the session transaction uses `transaction`. So the name still goes through `internalAdapter.updateUser`, with its hooks, on the connection and in the transaction that hold the lock.

What this means with Better Auth 1.7.25, from its source:

- It decides whether it is inside a transaction from its own async storage, which ours does not set. So what it queues until commit (`update.after` hooks, `refreshUserSessions` for secondary storage) runs as soon as the write returns: still inside our transaction, before it commits. None of these is configured in the base; `docs/auth.md` says so for the project that adds one.
- If Better Auth opened a transaction of its own inside the work, it would fail, since a Kysely transaction does not nest. `updateUser` opens none in 1.7.25; the live tests would show an upgrade that starts to.
- The proxy binds methods to the real instance, because Kysely keeps its state in private fields, and leaves what a getter returns as it is. The first version bound every function, which stripped `count` and the rest off `db.fn`, so Better Auth's user count threw and `/api/auth/admin/list-users` returned no users; the existing auth-flow live test caught it, and a unit test now covers it.
- When the transaction ends it is cleared from the async context, so work started inside it that is still running afterwards goes back to the pool rather than to a finished transaction.

The session route and Better Auth's view show the new name at once, as before: the existing live test (`methods.live.test.ts`, "trims and saves the name, and the session route shows it at once") passes unchanged.

### Tests

- **Unit** (`session-transaction.test.ts`): `sessionGrants` for present, missing, expired, banned, an ended ban and expiry at the very moment; the order lock, clock, read, work, with a scripted transaction and a fake clock writing to one log; each refusal is `auth.unauthenticated` before the work; an anonymous caller opens no transaction; the default clock. `transactions.test.ts`: the plain database outside, the transaction inside, getters kept, methods bound, work that outlives the transaction, failure passed on. Updated: `signedInOf`, the actor resolver, and `profile.update` running inside the session transaction.
- **Live** (`session-recheck.live.test.ts`): the hold is a second connection holding `for update` on the user's session rows; the test polls `pg_blocking_pids` until the request's backend is waiting on that connection (or the request has finished, so a request that never waits fails its own assertions instead of a timeout). No sleep. Four cases: a revocation committed while the update waits (refused, name unchanged); a revocation that commits after the update (the revoker is shown waiting on the update's lock, the new name stays, the next call is 401); an expiry passing while the update waits (the server's recheck clock is moved past the seven days while it waits); a ban committed while it waits, with the sessions left in place. `transactions.live.test.ts`: a write through Better Auth inside the transaction is invisible to another connection until commit and gone after a rollback (it fails when Better Auth is given the plain database), and `joinable` is the plain database outside one.
- **The race test before the fix**, run on `e7bd86b` with only the test added:

  ```text
  FAIL  |server-live| src/rpc/session-recheck.live.test.ts > profile.update rechecks its session inside its transaction > refuses, and writes nothing, when the session is revoked after the dispatcher's check
  AssertionError: expected 'After' to be 'Before' // Object.is equality

  Expected: "Before"
  Received: "After"
  ```

  After the fix, all four pass (see the verification below).

### Departures from this plan, with reasons

- **Unit tests changed where the types did.** `Actor` gained `sessionId` and `profileHandlers` a dependency, so the unit tests that build an actor (dispatcher, admin users, profile, session actor) or the handlers (profile, registry) changed. The existing live tests for `profile.update` and the session route, and the web and mobile profile screens' tests, are unchanged and pass.
- **`ServerLayerOptions.now` and `startAuthServer({ now })`** were added so the live expiry test can move the recheck's clock. Nothing else reads them; production uses the system clock.
- **The doc reference test** now has a second `describe.each` over the four docs the path check applies to, instead of `it.runIf` on every doc: 62 tests run, as before, and none is reported skipped (it was 62 passed and 23 skipped).

### Verification (section 6)

Run on 2026-11-20 on `a63f5a7`; the commit after it changes only this plan and the plan index. CI's run is recorded in the pull request description.

1. **From clean:** every `node_modules` removed, `bun install --frozen-lockfile` (857 packages, no changes), then `bun run agent:check` passed all eleven gates: 1,742 tests passed, none skipped; coverage 100% of statements (4,569), branches (2,342), functions (1,255) and lines (4,083). (The coverage report's "2 empty files skipped" is about source files with no code, not tests, and was there before.)
2. **Database up:** `bun run test:live` passed 63 tests in 13 files, including the four race tests and the two joinable-database tests; `bun run build` and `bun run smoke` passed (the built server answered `/health` and `/ready`, served the web app and exited 0 on SIGTERM); `bun run test:e2e` passed both journeys in Chromium.
3. **The race test:** failing before the fix by changing the name (above), passing after.
4. **CI:** see the pull request description.
5. **The scrub check** from plan 000 printed nothing.

### For later work

- The recheck does not recheck the role. A write limited to admins that must stop the moment an admin is demoted should read the role inside the transaction too; `docs/auth.md` says so.
- Work inside a session transaction cannot open a transaction through Better Auth. If a later Better Auth version wraps `updateUser` (or a project's own hooks) in one, the joinable database has to join it rather than fail.
