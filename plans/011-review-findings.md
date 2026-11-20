# 011: Address the findings of the full-branch review

> Status: implemented on 2026-11-20, with four findings partly done (section 12).

A follow-up to the rework ([000](000-hosted-starter-rework.md)), on the same pull request.

## 1. Where this comes from

On 2026-11-20 the whole branch (`af4ca30` to `bf8ddd7`, 692 files) was reviewed by five independent reviewers, each with a different focus (state and async, data integrity, boundaries, conformance to the plans and docs, layout and interaction). Their reports were merged into 88 findings, and every finding was then checked against the code by a separate verifier, which gave each a verdict:

| Verdict | Count | Meaning |
|---|---|---|
| Real | 12 | The defect exists and something reaches it today. |
| Minor | 46 | Real, but the effect is small or the trigger is narrow. |
| Latent | 21 | The code behaves as described, but nothing in the base reaches it today. |
| Unverified | 1 | The code path is confirmed; the outcome depends on something the verifier could not run. |
| Intended | 7 | The behaviour is a documented choice. |
| Wrong | 1 | The claim is false. |

This plan covers all 88. Findings are named `F1` to `F88` as in the review, so the two can be read side by side.

**Line numbers refer to commit `bf8ddd7`.** They will drift as fixes land; find the code by the quoted expression when a number no longer matches.

**The fixes below are suggestions, not designs.** No fix was tried against the code. For each one, write the failing test first (it is named with the fix), confirm it fails for the stated reason, then decide whether the suggested fix is the right one. Where a finding's own claim turns out not to hold when the test is written, record that in section 12 and move on.

## 2. Rules for this work

- `AGENTS.md` applies in full: a failing test first, no suppression, 100% coverage, no new dependency, the size limits.
- Decisions D1 to D10 of plan 000 are fixed. Where a finding asks for something a decision or a documented choice rules out, it is in section 10, not in the work.
- Fix the behaviour a finding describes, not just the line it names. Several findings name one screen and apply to its web and mobile twin; each entry says so.
- Each work package below is sized for one implementor and one review round. They are independent unless an entry says otherwise, and are listed in the order they should be done.
- This is a template. A "latent" finding matters when a project built from the base would reach it by doing something ordinary (importing users, adding a hold, editing the Dockerfile, adding an auth plugin). Section 8 separates those from the ones that need a broken upstream or a caller that does not exist.

## 3. Package A: server correctness and security

### F36 (real, Medium): client text can defeat the trusted-proxy address

- **Where:** `apps/server/src/http/client-ip.ts:33`: `if (entry === undefined || entries.some((item) => isIP(item) === 0)) return fallback;`. Its own comment at `:19` says anything left of the trusted entries is ignored. Consumers: the access log (`apps/server/src/http/routes.ts:240,252-258`) and the auth rate limiter's address (`apps/server/src/http/fetch-bridge.ts:62-63`).
- **What goes wrong:** with `TRUSTED_PROXY_HOPS=1`, a client sends `X-Forwarded-For: junk`. The server sees `junk, 203.0.113.9`; the trusted entry is valid, but `.some()` sees `junk` and returns the proxy's socket address. The client is absent from the access log and shares the proxy's rate-limit bucket.
- **Suggested fix:** validate only the entries inside the trusted window (the last `hops` entries), and return the entry that many hops from the right when it is a valid address. Entries further left are never read. Fall back to the socket address only when the trusted window itself is short or malformed.
- **Test first:** in `client-ip.test.ts`, hops 1 with `junk, 203.0.113.9` must give `203.0.113.9`; hops 2 with `junk, 198.51.100.7, 203.0.113.9` must give `198.51.100.7`; junk inside the window still falls back (the existing test at `:43`).
- **Docs:** `docs/deployment.md:140-147` should add that the server must be reachable only through the proxy, since a hop count cannot prove the last hop is one.

### F16 (real, Medium): an ended temporary ban still shows as "Banned"

- **Where:** `apps/server/src/rpc/admin-users.ts:24-35` selects `banned` but not `ban_expires`; `:55` returns `banned: row.banned === true`. The contract (`packages/contracts/src/admin.ts:9-18`) has no expiry. Both lists render it: `apps/web/src/routes/admin-users.tsx:78`, `apps/mobile/src/screens/users.tsx:52`. The rule the server enforces is `isBanned` in `apps/server/src/auth/instance.ts:82-85`.
- **What goes wrong:** Better Auth clears `banned` only at the user's next sign-in, so a user whose temporary ban has ended can use the app while the list still says "Banned". The route that sets a ban with an expiry is exposed (`apps/server/src/auth/allowed-routes.ts:46`).
- **Suggested fix:** select `ban_expires` and compute `banned` with the same `isBanned(row, now)` the session lookup uses, with the clock read once per request. Optionally add `banExpiresAt` to the contract so a list can show when a ban ends.
- **Test first:** a live test with three users (permanently banned, banned until the past, banned until the future) expecting `true`, `false`, `true`.

### F70 (real, Low): `set-role` ignores `LOG_LEVEL`

- **Where:** `apps/server/src/set-role-cli.ts:67`: `createLogger({ level: "info", write: options.write })`; `:78` logs `role_set` at info. `migrate-cli.ts:85` does switch to `config.logLevel`. `docs/deployment.md:93` lists the variable as read by set-role.
- **Suggested fix:** after the config parses, build the logger from `config.logLevel`, as migrate does. Usage and invalid-config output keep printing regardless.
- **Test first:** `LOG_LEVEL=error` prints no `role_set` line; an unknown email still prints its error.

### F3 (minor, rated High by the reviewers): app-role grants are applied one statement at a time

- **Where:** `apps/server/src/infra/postgres/migrator.ts:148` and the grant statements around it.
- **What goes wrong:** the statements autocommit separately. Between the broad grant and the revoke on the migrator's two tables, or after a crash between them, the app role can write the migration records, which `docs/deployment.md` says it never can.
- **Suggested fix:** run the grants and revokes in one transaction, and grant per table excluding the two bookkeeping tables rather than granting on all tables and then revoking.
- **Test first:** a live test that fails the statement after the grant (inject a failing statement) and asserts the app role still cannot insert into the migration table.

### F23 (minor, Medium): an RPC can renew the session in the database without renewing the cookie

- **Where:** `apps/server/src/auth/instance.ts:149` (the session lookup used by the RPC actor).
- **What goes wrong:** Better Auth's `getSession` extends `expires_at` when a session is due for renewal and sets a new cookie on its response. The RPC path calls it without returning those headers, so the database session is extended while the browser keeps the old cookie lifetime. Plan 006 fixed the same thing for the session route only.
- **Suggested fix:** make the actor lookup read-only (Better Auth's option to skip the refresh on this call, if 1.7.25 has one; check the installed source), so that only the session route renews. If no such option exists, forward the renewal headers on RPC responses too.
- **Test first:** a live test with a session past its renewal age: an RPC call must leave `expires_at` unchanged (read-only) or return the renewed cookie (forwarding), whichever approach is taken.

### F24 (minor, Medium): display-name rules differ between write paths

- **Where:** `apps/server/src/auth/allowed-routes.ts:31` exposes Better Auth's stock `update-user`, and sign-up takes any string; only `profile.update` applies `ProfileName` (`packages/contracts/src/profile.ts:13-16`: trimmed, 1 to 100 characters). A NUL character passes the contract and fails in Postgres.
- **Suggested fix:** enforce one rule at every write: add a `databaseHooks.user.create.before` and `update.before` in the options builder that applies the same `ProfileName` schema, and reject NUL in the schema. If nothing in the base needs the stock `update-user` route, move it to the not-exposed list instead.
- **Test first:** a live test that signs up with a 200-character name and with a name containing NUL, expecting a 400 from each, and the same through `update-user` if it stays exposed.

### F58 (minor, Low): a year-zero cursor gives a 500

- **Where:** `apps/server/src/rpc/user-cursor.ts:25-26`.
- **What goes wrong:** `0000-01-01T00:00:00.000000Z` is a valid JavaScript date, so the decoder accepts it; Postgres has no year zero and rejects the cast, which surfaces as a 500 instead of `rpc.invalid_cursor`.
- **Suggested fix:** bound the decoded year to Postgres's `timestamptz` range (reject below 0001 and above 9999).
- **Test first:** that cursor returns 400 `rpc.invalid_cursor` in a unit test and in the live pagination test.

### F71 (minor, Low): a test name claims cursor provenance that is not checked

- **Where:** `apps/server/src/rpc/admin-users.test.ts:73` ("refuses a cursor it did not issue"); the decoder at `user-cursor.ts:42` checks shape only.
- **Suggested fix:** rename the test to say what it tests (a malformed cursor), and correct the same wording in `docs/` and the error message if they claim provenance. Position-based cursors are the contract; do not add signing.

### F62 (minor, Low): static file serving

- **Where:** `apps/server/src/http/static-files.ts:47`, and the header comment at `:4-5`.
- **What goes wrong:** four small things. Size comes from `stat` and bytes from a later open, so a rebuild mid-request can send a wrong `Content-Length`. A file whose name starts with `..` (such as `..config.js`) is refused though it is inside the root. A permission error is reported as "not found". The `Accept` check is a substring search.
- **Suggested fix:** open the file once and take size and stream from the same handle (`handle.stat()`); compare path segments, not prefixes, for the parent-directory check; map `EACCES` to a 500 through the error path; parse `Accept` into media types before testing for `text/html`.
- **Test first:** one test per behaviour in `static-files.test.ts`.

### F69 (minor, Low): the access-log promise omits level filtering

- **Where:** `apps/server/src/http/routes.ts:2-3` (the comment), with the access line logged at `info`.
- **Suggested fix:** correct the comment and `docs/deployment.md` to say the access line is written at `info` and is therefore absent at `warn` and `error`. No code change.

### F35 (minor, Medium): work continues after the client has gone

- **Where:** `apps/server/src/http/routes.ts:138-139`.
- **Verdict detail:** the verifier found no wrong outcome: Node drops writes to a destroyed response. Suggested fix is limited to closing a file handle that was opened before the client left (`static-files.ts`), with a test that aborts a request mid-stream and asserts no open handle remains. Do not cancel work that has started a write.

### F86 (minor, Low): clock synchronisation is not documented

- **Where:** `apps/server/src/rpc/session-transaction.ts:73` judges expiry against the process clock; `docs/deployment.md:151` says any number of instances can run side by side.
- **Suggested fix:** one sentence in `docs/deployment.md` under "More than one instance": instances must keep their clocks synchronised, because session and ban expiry are judged by each instance's own clock.

## 4. Package B: session and client state

These touch `packages/client`, which web and mobile share. Do F10 first; several others build on the identity it introduces.

### F10 (real, Medium): the session guard tracks an epoch, not the user

- **Where:** `packages/client/src/query-state.ts:180-190`: `const started = epoch; ... if (epoch !== started) throw new StaleSessionError()`. The session query has `staleTime: 30_000` (`packages/client/src/session.ts:59-60`). Callers: `apps/web/src/routes/profile.tsx:39`, `apps/mobile/src/screens/profile.tsx`, and the user-list queries (`apps/web/src/routes/admin-users.tsx:24-35`, `apps/mobile/src/screens/users.tsx:22-33`).
- **What goes wrong:** tab A shows Alice's profile. In tab B the user signs out and signs in as Bob. Within 30 seconds, Save in tab A sends Bob's cookie; the epoch in tab A has not changed, so the guard passes, and the server renames Bob with the text typed for Alice.
- **Suggested fix, in two parts:**
  1. Cross-tab: publish session transitions on a `BroadcastChannel` (web only; guard for its absence) and have other tabs re-read the session when one arrives.
  2. Server-checked identity: a mutation that acts for "the user this screen was rendered for" sends that user's id, and the server refuses when the session's user differs. For `profile.update`, add `userId` to the payload and return `auth.unauthenticated` on a mismatch inside `sessionTransaction`. The client already treats that error as a session change.
- **Test first:** a client test with two gates sharing one fake server (two tabs), switching user in one and saving in the other, asserting the save is refused and Bob's name is unchanged. A live test for the server-side mismatch.

### F6 (real, Medium): a profile save overwrites a newer draft

- **Where:** `apps/web/src/routes/profile.tsx:33` (`useState(props.profile.name)`), `:40-42` (`onSuccess` calls `setName(profile.name)`), keyed by user at `:211`. Mobile: `apps/mobile/src/screens/profile.tsx:31-33`, keyed at `:78`.
- **What goes wrong:** the field stays editable while the save is pending. The user types `River` while `Robin` saves; on success `setName("Robin")` replaces the draft and shows "saved". Separately, a clean field never adopts a name changed elsewhere, because the state is seeded once.
- **Suggested fix:** keep two values: `saved` (from the query) and `draft` (what the user typed, or `null` when untouched). Render `draft ?? saved`. On success, clear `draft` only if it still equals the value that was submitted. Tie the "saved" notice to the submitted value. Do both platforms; move the logic into one hook in `packages/client` so there is one implementation.
- **Test first:** type during a pending save and assert the newer text survives; refetch with a new name while the field is clean and assert the field updates; refetch while dirty and assert the draft survives.

### F7 (minor, Medium): a save does not update other cached readers

- **Where:** `apps/web/src/routes/profile.tsx:40-45` and the mobile twin.
- **Suggested fix:** after a confirmed save, invalidate the admin user-list query for the same session; after an unknown outcome, re-read the profile instead of trusting local state.
- **Test first:** save a name, navigate to the user list, assert the new name without a stale flash in the test's query cache.

### F8 (minor, Medium): auth response tracking is global

- **Where:** `packages/client/src/auth.ts:92-101`: one failure counter for every call on the client. Mobile copies the approach (`apps/mobile/src/lib/auth.ts`).
- **What goes wrong:** a network failure in any overlapping auth request (the passkey list loading during Add) turns another call's definite answer into "unknown".
- **Suggested fix:** scope the observation to one operation: wrap `fetch` per call (a tracker created at the start of each action and passed through the client's `fetchOptions`), so a call sees only its own requests.
- **Test first:** two overlapping calls, one failing at the network, the other answered: the second must report its definite answer.

### F11 (minor, Medium): a stale mobile session response can rewrite the stored cookie

- **Where:** `apps/mobile/src/lib/auth.ts:107-109`: the cookie write happens after the response with no generation check.
- **Suggested fix:** capture a generation counter when the request starts, bump it on sign-in and sign-out, and skip the SecureStore write when the generation has moved.
- **Test first:** start a session read, sign out before it resolves, resolve it with a renewal header, assert the store is still empty.

### F14 (minor, Medium): the session is not re-read as time passes

- **Where:** `packages/client/src/session.ts:59-60`.
- **Verdict detail:** re-reading on focus and reconnect is the documented policy. The remaining gap is a page left open and focused past the session's expiry.
- **Suggested fix:** schedule one re-read at the session's `expiresAt` (add it to `AppSession` if it is not there), in addition to the focus rule. Have visitor-only pages (`sign-in`, `sign-up`) react when a session appears, by re-running `redirectSignedIn`.
- **Test first:** with fake timers, a session that expires while the page is idle moves the app to sign-in without a navigation.

### F15 (minor, Medium): a demoted admin keeps cached rows after a 403

- **Where:** `packages/client/src/query-state.ts:187` handles `auth.unauthenticated` only.
- **Suggested fix:** on `auth.forbidden` from a protected query, re-read the session; if the role changed, the existing role-change purge runs. Do not sign the user out on a 403.
- **Test first:** demote during "Load more": the rows and the Users link disappear after the 403.

### F20 (minor, Medium): client requests have no deadlines

- **Where:** `packages/client/src/transport.ts:131-142`; `settle` then waits on `refresh()`.
- **Suggested fix:** give the RPC transport and the session read a default timeout (`AbortSignal.timeout`, combined with the caller's signal) and map expiry to `NetworkError`, since the outcome is unknown. Do not put a timeout across the platform's passkey prompt.
- **Test first:** a response whose body never ends resolves to `NetworkError` after the deadline, and the control stops pending.

### F57 (minor, Low): proxy error bodies are treated as definitive answers

- **Where:** `packages/client/src/transport.ts:115-116`.
- **Suggested fix:** treat 502, 503 and 504 as a lost answer regardless of the body (plan 005 did this for the auth client; the RPC transport should match), and require the status and the envelope to agree before reporting an `RpcError`.
- **Test first:** a 503 carrying a well-formed error envelope is a `NetworkError`.

### F22 (minor, Medium) and F53 (minor, Low): what the screen says after an action whose follow-up read fails or has finished

- **Where:** `apps/web/src/routes/sign-in.tsx:41-45`; `packages/client/src/query-state.ts:211-213`; the `unknownOutcome` strings in `packages/i18n/src/locales/en.ts`.
- **What goes wrong:** the "we are checking your account now" text is shown after the check has finished, beside its result. A confirmed sign-in whose session read failed shows only the network message.
- **Suggested fix:** split the copy into a pending state ("checking") and terminal states ("we could not confirm; you are/are not signed in"), and give the failed-read case a "check again" control that re-reads the session without repeating the action.
- **Test first:** render each state and assert the pending text never appears with a terminal result.

### F9 (latent, Medium): a superseded session read is reported as a connection failure

- **Where:** `packages/client/src/query-state.ts:171-177`.
- **Reach:** needs two session refreshes overlapping on one screen; none does today. A project that adds a second action to the sign-in screen would reach it.
- **Suggested fix:** when a read is cancelled by a newer one, await the newer read's result instead of returning `undefined`.
- **Test first:** two overlapping `settle` calls; the first resolves with the second's session, not "unknown".

### F34 (latent, Medium): an unexpected auth exception leaves the screen stuck

- **Where:** `packages/client/src/query-state.ts:212-215` rethrows anything that is not a `NetworkError`; `apps/web/src/routes/verify-email.tsx:71-74,83` has no catch, so it stays on "Confirming…".
- **Reach:** needs an auth call that throws something else. A project that adds an auth plugin or a storage adapter (on mobile, a SecureStore write failing) reaches it.
- **Suggested fix:** catch at the screen boundary: `usePending` and the verify effect map an unexpected throw to an "unexpected error" outcome with a retry, and report it. Keep `settle` rethrowing, as its tests pin.
- **Test first:** an auth adapter that throws a plain `Error` leaves each screen showing the error state, not pending.

### F50 (latent, Low): double-submit guards depend on a render

- **Where:** `apps/web/src/routes/profile.tsx:54` (`if (save.isPending) return;`).
- **Suggested fix:** use the same synchronous latch the auth screens use (`packages/client/src/use-pending.ts:11-13`) for the profile save, on both platforms. F6's shared hook is the place.

## 5. Package C: web and mobile screens

### F18 (real, Medium): any verification refusal is shown as a dead link

- **Where:** `apps/web/src/routes/verify-email.tsx:74`: `setState(result.value.ok ? { kind: "verified" } : { kind: "invalid" })`.
- **What goes wrong:** a rate limit (429) or a server error (500) during verification shows "This link does not work. It may have expired or been used already", though the token may still be valid.
- **Suggested fix:** branch on the refusal: an invalid or expired token gives the dead-link state; a rate limit gives "too many attempts, try again in a moment" with a retry for the same token; anything else gives a generic failure with a retry. The "same answer whether or not the address exists" behaviour on forgot-password and resend is intended and stays.
- **Test first:** a 429 and a 500 from the verify endpoint each render their own state with a working retry.

### F47 (real, Medium): two passkeys can look identical at removal

- **Where:** `apps/web/src/routes/profile.tsx:105` (`passkey.name ?? t("passkeys.unnamed")`), `:120` (the remove button's label); passkeys are added with no name in `apps/web/src/lib/auth.ts:34-40`.
- **Suggested fix:** give every passkey a name at creation (a default such as "Passkey added 20 Nov 2026, 14:05", from a translated pattern), show the time as well as the date, and allow renaming (Better Auth's passkey plugin has an update endpoint; check that it is on the exposed list). The remove button's accessible name must be unique within the list.
- **Test first:** two passkeys added the same day have different visible names and different remove-button names.

### F48 (real, Medium): focus moves to an invalid field before its error exists

- **Where:** `packages/client/src/form.ts:39-40` (`first?.focus(); return { ok: false, errors };`), and `apps/web/src/components/EmailForm.tsx:27-28`. Affects sign-in (`apps/web/src/routes/sign-in.tsx:51-56`), sign-up (`sign-up.tsx:45-51`), forgot-password, the verification resend and the profile name form.
- **What goes wrong:** focus moves in the same tick the error state is set, so the field has no error text yet, and the error paragraph is not a live region. In a single-field form, pressing Enter in the already-focused field announces nothing. Plan 005 requires errors to be announced.
- **Suggested fix:** commit the errors first, then focus in an effect that runs after the render that shows them; and mark the field error with `role="alert"` (or put it in a polite live region) so it is announced when focus does not move. The mobile equivalent is `AccessibilityInfo.announceForAccessibility`.
- **Test first:** submit an invalid single-field form with focus already in the field; assert the error element exists with an alert role and is referenced by `aria-describedby` at the moment focus is set.

### F51 and F52 (minor, Low): stale validation and stale feedback

- **Where:** `apps/web/src/routes/sign-in.tsx:118`; `apps/web/src/routes/sign-up.tsx:57`.
- **Suggested fix:** clear a field's error and `aria-invalid` when its value changes; clear a server refusal when any field it concerned changes. Disable the fields, not only the button, while a submission is pending, so the result always describes what is on screen.

### F54 (minor, Low): passkey Add shows "Waiting for your device" during a Remove

- **Where:** `apps/web/src/routes/profile.tsx:158,179,189-191`: one pending flag for both operations; `passkeys.removing` in the catalog is unused.
- **Suggested fix:** track which operation and which passkey is pending; show "Removing…" on that row. On the sign-in page, hide or disable the passkey button with an explanation when the browser has no WebAuthn support, rather than failing on click.

### F17 (minor, Medium): the passkey list hides known rows on a failed refresh

- **Where:** `apps/web/src/routes/profile.tsx:176`.
- **Suggested fix:** when a refetch fails but data exists, keep the rows and show a "could not refresh" notice with a retry. Decode the list reply with a schema instead of trusting its shape. After add or remove, check the refetch's result instead of ignoring it.

### F19 (minor, Medium): an abandoned sign-in can still navigate

- **Where:** `apps/web/src/routes/sign-in.tsx:41-42`: `finish` navigates after an await even when the component has unmounted.
- **Suggested fix:** only navigate when the component is still mounted and the route is still `/sign-in` (an abort signal tied to unmount). The session still updates.

### F55 (minor, Low): recovery links drop the `redirect` destination

- **Where:** `apps/web/src/routes/sign-up.tsx:129-131`; sign-in's forgot-password link (`sign-in.tsx:140`); forgot-password's back link.
- **Suggested fix:** carry a validated `redirect` across the links between sign-in, sign-up and forgot-password. Never put it in a token-bearing URL.

### F13 and F25 (minor, Medium), F12 (latent, Medium): reset and verify pages after a lost reply or a new link

- **Where:** `apps/web/src/routes/reset-password.tsx:58-67`; `apps/web/src/routes/verify-email.tsx:69-84`.
- **What goes wrong:** after a reset whose answer was lost, resubmitting with the same token gets "invalid token", shown as "this link does not work", when the first attempt may have succeeded. Neither page resets its state when the token in the URL changes.
- **Suggested fix:** key each page's state on the token (`key={token}` on the inner component), so a new link starts clean. After an unknown outcome on reset, do not offer the same form again: say the password may have been changed and offer "sign in with the new password" and "request a new link".
- **Test first:** lose the reply, then assert the page does not present a resubmission that would misreport a consumed token.

### F56 (minor, Low): a failed background refetch of the user list is silent

- **Where:** `apps/web/src/routes/admin-users.tsx:85`; `apps/mobile/src/screens/users.tsx:61`.
- **Suggested fix:** show a non-blocking "could not refresh" notice with a retry when a refetch fails and data exists.

### F76 to F80, F84 (minor, Low): layout and focus

| Finding | Where | Suggested fix |
|---|---|---|
| F76 long unbroken names widen the page | `apps/web/src/components/ui.tsx:154` | `overflow-wrap: anywhere` on headings and table cells that show user-entered text. |
| F77 mobile links are tappable across the row | `apps/mobile/src/components/ui.tsx:100` | `alignSelf: "flex-start"` on link-styled controls, keeping the minimum touch height. |
| F78 the scrolling user table has no keyboard entry in Safari | `apps/web/src/routes/admin-users.tsx:47-48` | `tabIndex={0}`, `role="region"` and an accessible name on the scroll container. |
| F79 "Load more" can strand focus | `apps/web/src/routes/admin-users.tsx:88-97` | Use `aria-disabled` instead of `disabled` while pending; after the last page, move focus to the first new row or a "no more users" status. Same on mobile. |
| F80 the mobile startup error cannot scroll | `apps/mobile/src/screens/layouts.tsx:18` | Wrap it in a `ScrollView` inside the safe area. |
| F84 replacement screens drop focus | `apps/web/src/routes/reset-password.tsx:38-44` | When a form is replaced by its result, focus the result's heading (`tabIndex={-1}`). Apply to sign-up, forgot-password and verify as well. |

Each needs a test that fails first: a computed-style or DOM assertion on web, a tree assertion on mobile. The browser journeys (F72) are the place to check F78 and F84 in a real browser.

## 6. Package D: dependency-update workflow and other scripts

### F29 (real, Medium): the update PR cannot recover from some partial runs

- **Where:** `scripts/dependency-updates/flow.ts:498-500` (returns "unchanged" when no file differs), `:537-543` (push, then edit the PR body), `:584` (close the old PR), `:139` (`findOpenPr` takes only the newest).
- **What goes wrong:** if the push succeeds and the body edit fails, the retry sees no file change and stops, so the PR body describes older contents. If the new PR is created and closing the old one fails, later runs never close it.
- **Suggested fix:** decide "nothing to do" from the remote state, not the working tree: compare the PR's head and its body with what this run would produce, and repair either. Have `findOpenPr` return every open labelled PR, keep the newest, and close the rest.
- **Test first:** in `flow.test.ts`, fail the body edit once and rerun, asserting the body is corrected; leave two open PRs and assert the older is closed.

### F49 (unverified, Medium): a range hold may hide the newest permitted update

- **Where:** `scripts/dependency-updates/holds.ts:113`: `keepLocked: hold.range === undefined || hold.group !== undefined`.
- **To settle first:** in a throwaway workspace with a local registry fixture (or two real versions of a small package), hold a package to a range, let the update move it past the range, and read `bun.lock` after the restore. If bun resolves to the newest in-range version that passes the age gate, record that in section 12 and add the case as a test. If it does not, resolve the target explicitly: pick the newest version satisfying both the range and the age rule and install that.

### F27 (latent, Medium), F61 (latent, Low): hold parsing and ranges

- **Where:** `scripts/dependency-updates/holds.ts:76` (a missing `holds` key parses as no holds); `scripts/dependency-updates/manifests.ts:44` (the last declaration of a package wins); `scripts/dependency-updates/semver.ts:33` (`^0.0.3` is treated as below `0.1.0`).
- **Reach:** a project adds its own holds; a package declared at two sites with different specs; a `^0.0.x` range.
- **Suggested fix:** fail loudly when the holds file has no `holds` array; collect every declaration of a package and check each against the hold; implement npm's caret rule for `0.0.x` (exactly that patch) and `0.x` (that minor).
- **Test first:** a file without the key throws; two declarations are both checked; `^0.0.3` rejects `0.0.4`.

### F1 (minor, rated High by the reviewers): the updater selects its PR by label alone

- **Where:** `scripts/dependency-updates/flow.ts:127-139`.
- **Suggested fix:** require all three before treating a PR as the updater's: the label, a head branch matching `deps/update-YYYY-MM-DD`, and the base being the default branch. Skip and report anything else.

### F59 (minor, Low), F82 (minor, Low), F60 (latent, Low), F81 (latent, Low): the update report and release selection

| Finding | Where | Suggested fix |
|---|---|---|
| F59 a failed Expo check is reported as drift | `scripts/dependency-updates/flow.ts:398-404` | Distinguish a non-zero exit with drift output from a failure to run; report the latter as "could not check". Include added and removed lock entries in the change lists (`:445,458`). |
| F82 the age report shows unrelated release metadata | `scripts/dependency-updates/outdated.ts:24` | Report the held-back version from the column that carries the marker, not the registry's `latest`. |
| F60 a malformed Node date passes the age gate | `scripts/dependency-updates/releases.ts:52-53` | Require `Number.isFinite(published)`, as the bun check at `:34-35` does. |
| F81 bun releases: one page of 30 | `scripts/dependency-updates/flow.ts:86` | If no eligible release is on the page, say "no eligible release in the newest 30" in the report instead of "no update". |

### F83 (latent, Low): image updates apply the first stage's variant to every stage

- **Where:** `scripts/dockerfile-versions.ts:109-111,124`.
- **Reach:** a project whose Dockerfile uses two variants of one runtime.
- **Suggested fix:** rewrite each `FROM` with its own variant and resolve a digest per distinct tag; if a tag cannot be resolved, leave that runtime untouched and report it.

### F40 (real, Medium): `bun dev` leaves children running when one fails to spawn

- **Where:** `scripts/dev.ts:25` (`once(child, "exit")` rejects on a spawn error), `:53-54` (`Promise.race` then `stopAll`); `scripts/dev.main.ts:6` has no catch. The smoke script has the smaller form of the same thing at `scripts/smoke-built-server.ts:167,184`.
- **What goes wrong:** a missing `vite` binary makes the supervisor throw before `stopAll`, so the server and the local inbox keep running and hold their ports. The verifier reproduced this.
- **Suggested fix:** listen for `error` as well as `exit` on each child and treat a spawn error as that child's exit; wrap the race so `stopAll` always runs (`try/finally`); in smoke, attach the rejection handler when the child is created.
- **Test first:** supervise two children where one is a missing binary; assert the other is stopped and the error names the missing command.

### F42 (minor, Medium): a local SES endpoint the config accepts can stop `bun dev`

- **Where:** `scripts/ses-local/run.ts:14`; `scripts/dev.ts:89-92` starts the capture server for any non-empty `SES_ENDPOINT`.
- **Suggested fix:** one shared validator for "an endpoint the built-in capture server can listen on" (http, loopback, explicit port), used by the config module's development rule and by the capture server, so the two cannot disagree.

### F41 (latent, Medium), F85 (latent, Low), F66 (latent, Low): the local inbox

| Finding | Where | Suggested fix |
|---|---|---|
| F41 handler errors are dropped | `scripts/ses-local/server.ts:317` (`void handle(...)`) | Catch at the listener and answer 500 while the response is writable. |
| F85 capacity zero keeps everything | `scripts/ses-local/server.ts:277` | Validate `maxEmails` as a positive integer when the server is created. |
| F66 impossible timestamps are normalised | `apps/server/src/infra/email/sigv4.ts:285` | After `Date.UTC`, check that the parts round-trip; reject otherwise. |

### F32, F33 (minor, Medium), F64 (latent, Low), F30 (latent, Medium): other scripts

| Finding | Where | Suggested fix |
|---|---|---|
| F32 container smoke can leak roles and databases | `scripts/container/smoke.ts:499-500` | Record each resource as it is created and enter the `try` before the first one; clean up every recorded resource, and report a cleanup failure without replacing the primary error. |
| F33 the audit triage accepts an impossible date | `scripts/quality/dependency-audit.ts:31` | Parse the expiry as a calendar date and reject one that does not round-trip (`2026-13-01`). |
| F64 a repeated export can leave stale links | `scripts/container/runtime-dependencies.ts:202` | Refuse to export into a non-empty directory. |
| F30 rename compares a set of versions | `scripts/rename/rules.ts:137-140` | Compare the lockfile's package entries one for one, ignoring only workspace names. The "irrecoverable" half of this finding is false: rename refuses a dirty tree, so `git reset --hard` restores it. |

## 7. Package E: docs, tests and repository hygiene

### F45 (real, Medium): the phone guide leaves the API on loopback

- **Where:** `docs/mobile-dev.md:76` says the server listens on every interface by default; `.env.example:11` sets `HOST=127.0.0.1`, and `scripts/local-env.ts:21-31` always loads it.
- **Suggested fix:** correct the doc: the fresh-clone default is loopback; to reach the server from a phone on the same network, set `HOST` to the machine's LAN address (or `0.0.0.0`) in `.env`, and say that the local inbox stays on loopback. Keep the loopback default.
- **Check:** follow the corrected steps from a second machine on the network and record the result in section 12.

### F46 (real, Medium): the private-network URL becomes Vite's bind address

- **Where:** `apps/web/vite.config.ts:18-19` binds Vite to `APP_URL`'s host and port; step 6 of the recipe at `docs/mobile-dev.md:95` sets `APP_URL` to the forwarder's https origin.
- **What goes wrong:** Vite tries to bind the forwarder's own host and port (or 443), with `strictPort`, so the forwarded backend has no listener.
- **Suggested fix:** separate "where the browser reaches the app" from "where Vite listens": add optional `WEB_DEV_HOST` and `WEB_DEV_PORT` (defaulting to `APP_URL`'s when it is a loopback origin, and to `127.0.0.1:5173` otherwise), and allow `APP_URL`'s hostname in Vite's `server.allowedHosts`. Update the recipe and `docs/setup.md:79`.
- **Check:** this needs a real forwarder to prove; say plainly in section 12 whether it was tried.

### F44 (minor, Medium): standalone `dev:server` and `smoke` omit the migration step

- **Where:** `docs/setup.md:32`; `package.json:59,86`.
- **Suggested fix:** document `bun run db:migrate` as a prerequisite for both, and make the server's "unmigrated database" error name the command.

### F72 (minor, Low): the browser journeys skip the accessibility check on some pages

- **Where:** `docs/quality.md:154` claims every page visited is checked; the journeys in `e2e/journeys.spec.ts` skip the post-sign-out sign-in page, the setup pages of the passkey journey, home after passkey sign-in, and the empty passkey state.
- **Suggested fix:** add the missing checks; where a page is the same state as one already checked, say so in the doc instead.

### F73 (minor, Low): the mobile manifest's literal versions

- **Where:** `apps/mobile/package.json:28` and the 16 other literal specs; `AGENTS.md:52` states the catalog rule without the exception.
- **Suggested fix:** state the exception where the rule is stated: Expo-managed packages carry the SDK's version in the mobile manifest because `expo install` writes it there.

### F75 (minor, Low): a test assertion that can pass early

- **Where:** `apps/web/src/routes/auth-pages.test.tsx:477-479`.
- **Suggested fix:** record the session-request count after mount and assert a further request after the reset, or assert a session result only the post-reset read could produce.

### F43 (minor, Medium): the bare-origin guard accepts normalised paths

- **Where:** `packages/shared/src/origin.ts:22`.
- **What goes wrong:** `https://api.example.com/a/..`, `https://@api.example.com` and `https:api.example.com` are accepted because the parsed URL has an empty path.
- **Suggested fix:** also require the input (minus an optional trailing slash) to equal the parsed origin, so only the canonical spelling passes.
- **Test first:** those three inputs return `null`; `https://api.example.com` and `https://api.example.com/` still pass.

### F2 (latent, rated High by the reviewers): the role CLI can change several accounts and report one

- **Where:** `apps/server/src/set-role-cli.ts:45-50`: an update where `lower(email) = lower($1)`, `returning("id").executeTakeFirst()`.
- **Reach:** two users whose emails differ only by case, which an import of existing users can create.
- **Suggested fix:** select the matching ids first, inside a transaction; refuse with a clear error when more than one matches; update by id.
- **Test first:** a live test with two such rows expects a refusal and no change.

### F4 (latent, rated High), F26 (latent, Medium), F39 (latent, Medium): migrate and schema checks

| Finding | Where | Suggested fix |
|---|---|---|
| F4 the schema name is not bound to the search path | `apps/server/src/migrate-cli.ts:44`; `apps/server/src/infra/postgres/migrator.ts:234`; `apps/server/src/server.ts:160-165` | Qualify the migration table with the schema everywhere, and refuse to run when the connection's `current_schema()` differs from the target schema. |
| F26 the schema check ignores defaults and constraint validity | `apps/server/src/auth/schema-check.ts:159-185` | State the limits in the file's header; add `indisvalid` and `convalidated` to the queries. Defaults stay out of scope, as documented. |
| F39 CLI failure handling misses open and close | `apps/server/src/set-role-cli.ts:77-87`; `apps/server/src/migrate-cli.ts:45-69` | Move construction inside the `try`; catch a `destroy()` failure, log it, and keep the primary exit code. |

### F31 (latent, Medium), F63 (latent, Low), F65 (latent, Low): email

| Finding | Where | Suggested fix |
|---|---|---|
| F31 a JSON `null` reply escapes classification | `apps/server/src/infra/email/ses.ts:157,161,228-229` | Check the parsed body is an object before reading its properties; otherwise classify as "unavailable". The retry-on-5xx half is the documented choice and stays. |
| F63 "one hour" is written separately from the expiry | `apps/server/src/auth/email/render.ts:5-9`; the strings in `packages/i18n/src/locales/en.ts:81,118,249,255` | Interpolate the duration into the copy from the constant, or add a test that fails when the constant and the copy disagree. |
| F65 tokens in URLs and referrers | `apps/server/src/auth/options.ts:52-53`; `apps/server/src/http/security-headers.ts:25` | Send `Referrer-Policy: no-referrer` on the two token pages, and add a line to `docs/deployment.md` telling operators to redact query strings in proxy logs. |

### F87, F88 (minor, Low), and the two leads

- **F87:** `plans/005-web-blank-slate.md:154` says the web config imports nothing; it now imports the shared origin parser. Add a dated note to that plan.
- **F88:** remove the extra blank line at the end of the two plan files `git diff --check` reports. Leave the vendored signing fixtures byte-exact.
- **L1:** `apps/mobile/src/lib/query-lifecycle.ts:5` says signing out in a browser revokes the native session; `plans/006-mobile-blank-slate.md:208` says the sessions are separate. Read the code, decide which is true, and correct the other.
- **L2:** going Back to the user list after paging was not checked in a browser (`apps/web/src/router.tsx:45` keeps `scrollRestoration: false`). Add it to a browser journey and fix what it shows.

## 8. Which latent findings to do, and which to leave

All 21 have a suggested fix above. Do them in this order of value to a project built from the base:

1. **Reached by ordinary project work:** F2 (importing users), F34 (adding an auth plugin or storage adapter), F27 and F61 (adding holds), F83 (editing the Dockerfile), F9 (adding an action to a screen), F12 (linking to the verify page in-app), F4 (a non-default schema), F60 (one line, matching the check beside it).
2. **Cheap and local, worth doing while there:** F39, F41, F50, F63, F64, F66, F85, F81, F31, F26.
3. **Needs a deployment choice, so document rather than build:** F65.
4. **Low value; do last or record as accepted:** F30.

If a latent finding is not done, list it in section 12 with the reason, so the decision is on record.

## 9. A pre-existing defect

- **P1 (Low):** static file serving follows a symlink inside the web build after only a path check (`apps/server/src/http/static-files.ts:44-47,64-70,109`). The base before the rework did the same. If F62 opens the file once, resolve its real path there and check containment on that.

## 10. Findings with no code change

The verifiers rated these as documented choices or as false. They are listed so nobody re-raises them unknowingly. Where a short doc sentence would have prevented the finding, add it.

| Finding | Claim | Why it stands |
|---|---|---|
| F5 | Destructive migrate commands cannot be replayed safely | `down` and `reset` are development commands, refused in production (`apps/server/src/infra/postgres/migrator.ts:245-248`). |
| F21 | The profile transaction checks expiry before the user-row wait | The session recheck is deliberately the point of decision (`apps/server/src/rpc/session-transaction.ts:64-81`). |
| F28 | The updater can move the Better Auth group without `better-call` | The hold's reason and `docs/dependencies.md` say a person moves it. Optional: have the update PR's body say so whenever the group moves. |
| F37 | Split-origin configuration conflates web and API origin | The docs choose `APP_URL` as the web origin (`docs/setup.md:73`). Optional: rename `/config`'s `apiBaseUrl`, which is the one confusing name. |
| F38 | Logs are not redacted | A test requires the error text in the log and out of the response (`apps/server/src/http/routes.test.ts:500-504`); the promise is about named secrets. |
| F67 | Exposed account and admin routes have no UI | Plans 005 and 006 define the UI scope; `docs/auth.md` points admins at the API. |
| F68 | Report-only update results disappear when no file changes | `docs/dependencies.md` step 6 chooses to leave the PR alone. F29's fix changes how "nothing to do" is decided; keep this choice when doing it. |
| F74 | The browser tab title is not translated | False: `PageShell` sets it from translations on every page (`apps/web/src/components/ui.tsx:144-148`). |

## 11. Verification and definition of done

For each package, on its final commit:

1. From clean: frozen install and `bun run agent:check`, with 100% coverage and no skipped test.
2. Database up: `test:live`, `smoke`, `test:e2e`; for package D also `bun run deps:update --dry-run`; for anything touching the image, `docker:build` and `docker:smoke`; for anything in `apps/mobile`, `mobile:export`.
3. For every finding fixed: the test that failed before the fix, named in section 12.
4. CI green on the head commit, all jobs.
5. The scrub check from plan 000 prints nothing.

Done when every finding in sections 3 to 9 is either fixed with its test, or listed in section 12 as not done with the reason, and the docs the fixes touch are true of the code.

## 12. How it was built

Implemented on 2026-11-20 by three implementors working in parallel, each in its own worktree, on slices divided by file ownership rather than by the five packages above, so that no two edited the same files: the server (22 findings), the shared client with the web and mobile apps (37 findings and the two leads), and the scripts, dev tooling and docs (24 findings). Each finding had its failing test written and seen to fail before the code changed. The three branches merged without conflict.

### Outcome

| Outcome | Findings |
|---|---|
| Fixed, with a test that failed first | 67 of the 88, plus the pre-existing defect P1 |
| Fixed in docs or wording only (no test could fail first) | F69, F86, F71, F45, F44 (docs half), F73, F87, F88, L1 |
| Found not to hold | F49, F35 |
| Partly done | F14, F47, F63, L2 |
| No code change, as section 10 says | F5, F21, F28, F37, F38, F67, F68, F74 |

### Found not to hold

- **F49:** settled by experiment in a throwaway bun 1.4.4 workspace with the 3-day gate. A package held to `0.28.x` was moved to `^0.29.9` by `bun update -r --latest`; with the spec put back and no pin, `bun install` locked `0.28.20`, the newest 0.28 release the gate allows (`0.28.19` under a 10-day gate). bun re-resolves inside the restored range, so a range hold does not hide the newest permitted update. A flow test pins the behaviour; no code changed.
- **F35:** as the verifier said, nothing to reproduce. F62 now opens the file earlier, so three tests check the handle is closed when the client has gone.

### Partly done, and what is left

- **F14:** visitor-only pages now leave when a session appears. Not done: re-reading the session at its expiry. `AppSession` carries no expiry, and adding one changes the server's session route, which belonged to another slice.
- **F47:** new passkeys get a name with the date and time, and each remove button has a unique name. Not done: a rename control. The route is exposed; the UI is not built.
- **F63:** the emails were already tied to the expiry constant by a test. A new test checks every catalog string that states a lifetime against the constant. The duration is not interpolated into the screen strings.
- **L2:** a new browser journey shows that going Back keeps both pages of the user list. The scroll position resets to the top; the router's own scroll restoration did not restore it in this flow and was reverted.
- **From F24:** the client's `validateName` reports a name containing a NUL as "too long". It needs its own message.
- **Noticed, not changed:** the update PR's body says "newest allowed" of the version it refused.

### Departures from the suggested fixes

- **F10:** both parts were built. `profile.update` now takes `{userId, name}` and refuses a mismatch with `auth.unauthenticated` inside `sessionTransaction`; the web app passes a `BroadcastChannel` to the session gate so other tabs re-read the session when the user changes.
- **F4:** `migrate` keeps targeting `public` and refuses when the connection's current schema differs; the server reads applied migrations in its connection's current schema only.
- **F24:** `update-user` stays exposed, as `docs/auth.md` documents. The name rule is applied in Better Auth's database hooks on every create and update of a user.
- **F23:** Better Auth 1.7.25 has a `disableRefresh` option, so the RPC session lookup is read-only and only the session route renews.
- **F43:** the raw spelling is checked with a pattern, because requiring the input to equal the parsed origin would refuse an upper-case host with an explicit default port, which an existing test accepts on purpose.
- **F16:** no expiry was added to the contract; the list computes `banned` with the rule the session lookup uses.
- **F8:** Better Auth's per-call fetch option replaces the global counter. `trackNetworkFailures` is gone.
- **F48:** field errors are alerts only in single-field forms; sign-in and sign-up already have a summary alert.
- **F46:** Vite listens on `APP_URL`'s host and port when `APP_URL` is http, and on `127.0.0.1:5173` when it is https. The suggested loopback test would have broken the documented phone setup.
- **F29:** each update PR's body ends with a hidden line naming the commit it describes; a run with no file change rewrites the body only when that line disagrees with the PR's head. The documented choice to leave a correct PR alone is kept. Older update PRs are closed even on a run with no change.
- **F1:** a PR must also come from a branch of this repository.
- **F27:** specs are tracked and restored per place of declaration.
- **F32:** each role and the database are created by a separate run, so cleanup knows exactly what exists.

### Two lint allowances were added

Both are in `.oxlintrc.json` with their reasons, and listed in `docs/quality.md`:

- `unicorn/require-post-message-target-origin` is off for `packages/client/src/query-state.ts`: the rule reads a `BroadcastChannel`'s one-argument `postMessage` as `window.postMessage`.
- `jsx-a11y/no-noninteractive-tabindex` allows `tabIndex` on a `<section>`, so the user table's scroll region can take keyboard focus.

### Found after the merge

- **A gap in F11's fix**, found in review of the pushed result: the mobile cookie store checked the generation before its storage read but not after, so a renewal whose read was pending when a sign-in or sign-out began was still written. It now checks again after the read. Test: "does not write a renewal when a sign-out starts while its storage read is pending".
- **The user-list browser journey** expected a full second page, which held only on a local test database other runs had filled. On a fresh database, as in CI, the second page has four users. It now expects more rows than the first page held.

### Verified on the merged result

- `bun run agent:check`: all eleven gates; 1,951 tests; 100% of statements (5,024), branches (2,607), functions (1,388) and lines (4,480). No suppression, no new coverage exclusion, no new dependency.
- With the database up: `db:migrate`, `db:generate:check`, `test:live` (77 tests), `build`, `smoke`, `test:e2e` (three journeys), `mobile:export`, `docker:build` and `docker:smoke`.
- The scripts slice also ran `rename:proof` and a dry run of the dependency update on its own branch.

### Not verified

- Nothing was seen on a device or with a screen reader: the announcements of field errors, where focus lands on result pages and after "Load more", the scrolling startup error, and the tap area of link-styled buttons on iOS and Android.
- The private-network recipe was not tried through a real forwarder, and the phone guide was not followed from a second machine.
- The dependency-update workflow itself still cannot run before the branch is merged.
- Running `bun dev` or the browser journeys from a second checkout recreates the shared local Postgres container, because the compose project is the same and its configuration differs per checkout. The data volume survives; open connections drop.
