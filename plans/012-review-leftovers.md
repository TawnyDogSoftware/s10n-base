# 012: Finish what the review left open

> Status: not started

A follow-up to [011](011-review-findings.md), on the same pull request as the rework ([000](000-hosted-starter-rework.md)). Plan 011's section 12 lists what was left "partly done"; this plan finishes five of those items.

## 1. Why

Each of the five is small, and each is something a project made from the base would copy or trip over:

1. **F14:** a page left open past the session's expiry looks signed in until the next action fails.
2. **F47:** a passkey cannot be renamed, although the route for it is exposed.
3. **L2:** going Back to the user list loses the scroll position.
4. **From F24:** a name with a NUL character is reported as "too long".
5. **Noticed in 011:** the daily update PR says "newest allowed" of the version a hold refused.

**Line numbers refer to commit `283b995`.** Find the code by the quoted expression when a number no longer matches.

**What was checked and how.** Everything under "Where" and "What is wrong" below was read in the code at that commit, and library behaviour in the installed sources under `node_modules` (Better Auth and its passkey plugin 1.7.25, `@tanstack/react-router` 1.170.46 with `@tanstack/router-core` 1.171.39, React Native 0.88.1). Nothing was run in a browser, on a device or against a database. Each item says what that leaves unverified.

## 2. Rules and scope

- `AGENTS.md` applies in full: a failing test first, seen to fail for the stated reason; no suppression; 100% coverage; the size limits; every user-visible string from `packages/i18n`.
- **No new dependency.** None of the five needs one.
- **No migration.** Nothing here changes a table.
- Out of scope: passkeys on mobile (`docs/mobile-dev.md` says what they would need), F63 (interpolating the lifetime into screen strings), any change to how long a session lasts or when it is renewed, and the layout of the header.
- The fixes below were designed by reading, not by trying them. Where the failing test shows a claim here does not hold, record that in section 11 and do what the test shows.

## 3. Order of work

Smallest first, and item 4 before item 2 because the rename form reuses the validation item 4 changes:

1. Item 5 (the update PR's wording).
2. Item 4 (the NUL message).
3. Item 1 (the session's expiry).
4. Item 2 (renaming a passkey).
5. Item 3 (scroll position on Back).

One commit per item, each with its tests, then one for the docs and this plan's record.

## 4. Item 5: the update PR mislabels a refused version

- **Where:** `scripts/dependency-updates/flow.ts:626`, in `describe`:
  `` `${restoration.name} stays at ${restoration.restoredTo} (newest allowed: ${specBaseVersion(restoration.attempted) ?? restoration.attempted}): ${restoration.reason}` ``.
  `attempted` is the spec `bun update --latest` wrote before the hold put the old one back (`scripts/dependency-updates/holds.ts:123`).
- **What is wrong:** the bracketed version is the one that was refused. It is the newest release the 3-day rule allows, which is where "newest allowed" came from, but under the heading "Reported, not applied", next to "stays at", it reads as the newest version the hold allows.
- **Fix:** change the line to `` `${name} stays at ${restoredTo}, not ${attempted}: ${reason}` ``, with the same `specBaseVersion(...) ?? attempted` for the second version. Examples: `react stays at 19.3.0, not 19.3.1: Owned by the Expo SDK.` and `react stays at 19.3.0, not canary: Owned by the Expo SDK.`
- **Failing test first:** change the two expectations that pin the text, `scripts/dependency-updates/flow.test.ts:452` and `:976`, to the new wording; both then fail on the old text.
- **What else pins the text:** nothing. `docs/dependencies.md:108` describes the section without quoting a line. `plans/002-toolchain-upgrade-and-ci.md:289-291` quotes the old wording inside the recorded output of a past dry run; it is a record and stays as it is.
- **For a project made from the base:** only the text of the PR body changes. Nothing in the repository reads it back.

## 5. Item 4: a NUL character in a name is reported as "too long"

- **Where:** `packages/client/src/validation.ts:50-57`, `validateName`. Any failure of the contract's `ProfileName` (`packages/contracts/src/profile.ts:14-18`: trimmed, 1 to 100 characters, no NUL) that is not an empty name becomes `validation.nameTooLong`. Callers: the web and mobile sign-up forms and the shared profile name form (`packages/client/src/profile-name.ts:85`).
- **What the server does with the same name**, which the client check normally keeps from being sent:
  - Sign-up and Better Auth's `update-user`: `checkUserName` (`apps/server/src/auth/options.ts:175-182`) answers 400 with the code `INVALID_NAME`. The catalog has no `errors.betterAuth.INVALID_NAME`, so `errorMessageKey` (`packages/client/src/messages.ts:19-26`) falls back to `errors.generic`: "Something went wrong. Try again."
  - `profile.update`: the payload fails `ProfileName` in the dispatcher and the form shows `errors.rpc.invalid_payload`: "Some of the details are not valid. Check them and try again."
  - So neither path says "too long", and the sign-up path says nothing useful.
- **Fix:**
  1. `packages/contracts/src/profile.ts`: export the pattern for a character a name may not hold, `PROFILE_NAME_FORBIDDEN = /\0/`, beside `PROFILE_NAME_MAX`, and build the schema's own check from it (a name is valid when the pattern finds nothing), so the rule is written once. A constant, not logic: the contract package stays schemas and their limits.
  2. In `validation.ts`, add a member to `FieldError`: `{ readonly key: "validation.nameInvalid"; readonly values: { readonly character: string } }`, and a case for it in `fieldErrorText`. In `validateName`, after the empty check: if `trimmed.length > PROFILE_NAME_MAX` return `nameTooLong`; then decode with the contract, and for any remaining failure return `nameInvalid` with the first character `PROFILE_NAME_FORBIDDEN` finds in the name. The contract stays the authority; the length test and the search only choose the message. Both branches are reachable (101 characters; a NUL), so coverage holds.
  3. **The message names the character** (the owner's decision, 2026-11-21). The only character the rule refuses is one that cannot be seen, so it is shown by its code point: `character` is `U+` and the code point in upper-case hexadecimal, at least four digits (`U+0000` for a NUL). One small function does it, from the character's `codePointAt(0)`; it has no branch for a visible character, because the rule refuses none. A project that forbids visible characters adds that branch with its rule.
  4. `packages/i18n/src/locales/en.ts`, `auth.validation`: `nameInvalid: "The name contains a character that cannot be used: {{character}}. Please try another name."` It does not say "type it again", which would read as typing the same name.
  5. `errors.betterAuth`: `INVALID_NAME: "That name cannot be used. Please try another name."`, so a refusal by the server's hook has a message of its own on both apps. The server's answer does not say which character it refused, so this message cannot either; the client's check runs first and does. `AUTH_ERROR_CODES` is derived from the catalog (`packages/i18n/src/index.ts:113`), and the existing i18n test then covers the new code.
  6. `profile.update`'s server-side message stays `errors.rpc.invalid_payload`: it already says the details are not valid, and it is the dispatcher's one answer for every method.
- **Failing tests first:**
  - `packages/client/src/validation.test.ts`: `validateName("Sam\u0000")` equals `{ ok: false, error: { key: "validation.nameInvalid", values: { character: "U+0000" } } }`. Today it returns `nameTooLong`. Keep the 101-character case. `fieldErrorText` for that error gives the English text with `U+0000` in it.
  - `packages/contracts/src/contracts.test.ts` (or the profile contract's own test): `ProfileName` still refuses a NUL and accepts what it accepted, now through `PROFILE_NAME_FORBIDDEN`. This one does not fail first; it guards the refactor.
  - `packages/client/src/messages.test.ts`: an auth failure with the code `INVALID_NAME` maps to `betterAuth.INVALID_NAME`. Today it is `generic`.
  - One screen test, in `apps/web/src/routes/auth-pages.test.tsx`: submitting the sign-up form with a NUL in the name shows the new text, with `U+0000`, on the name field. The mobile forms use the same function and `fieldErrorText`; no mobile test is needed beyond what typecheck requires.
- **For a project made from the base:** `FieldError` gains a member with a `character` value, so a project's own exhaustive `switch` over it needs a case, and every other locale's catalog needs the two new keys (the catalog test names what is missing).

## 6. Item 1 (F14): re-read the session when it expires

### What happens today

- The session query (`packages/client/src/session.ts:54-63`) has `staleTime: 30_000` and no interval. The re-read on window focus and on reconnect is TanStack Query's default behaviour for a stale query, not code in that file; the mobile app feeds the same two signals from `AppState` and the network state (`apps/mobile/src/lib/query-lifecycle.ts:25-41`). A page that stays focused and online is never told its session ended.
- `AppSession` (`packages/contracts/src/session.ts:9-16`) has six fields and no expiry.
- The session route (`apps/server/src/http/routes.ts:113-119`, `readAppSession` in `apps/server/src/http/auth-routes.ts:108-111`) calls `auth.readSession` (`apps/server/src/auth/instance.ts:153-156`), which calls Better Auth's `getSession` with `returnHeaders` and passes on its cookies. Better Auth renews there: once a session is a day old it sets `expiresAt` to seven days from now, sets a new cookie, and answers with the **updated** session (`better-auth/dist/api/routes/session.mjs:181-225`). The RPC lookup passes `disableRefresh` (`instance.ts:151-152`) and never renews. So the expiry moves, at most once a day, and only through the session route.
- `sessionOf`, `signedInOf` and `readSessionOf` (`instance.ts:101-128`) receive Better Auth's result but read only its `user`; `toAppSession` (`instance.ts:89-98`) takes the user alone.
- Both apps build the gate with `createSessionGate` (`apps/web/src/services.tsx:40-44`, `apps/mobile/src/services.tsx:43`) and read the session with `useSession`. The gate (`packages/client/src/query-state.ts`) already sees every new session in `accept` (`:198-203`), can read it again with `refresh` (`:229-235`) and has `dispose` (`:283-286`). **The timer belongs in the gate, not in `session.ts`:** neither app then changes.

### The change

1. **Contract.** `AppSession` gains `expiresAt: Schema.String`: the moment the session ends, as an ISO 8601 instant in UTC, as `Profile.createdAt` is. Required, not optional (decision D1 in section 9).
2. **Server** (`apps/server/src/auth/instance.ts`):
   - `toAppSession(user: AuthUser, expiresAt: Date | string): AppSession` adds `expiresAt: new Date(expiresAt).toISOString()`.
   - `sessionOf`, `signedInOf` and `readSessionOf` take a result whose `session` has `expiresAt` (`signedInOf` already takes `session.id`) and pass it on. `createAppAuth` needs no change beyond types: both calls already hand over Better Auth's whole result.
   - The route and `encodeSessionResponse` need no change; the schema carries the field. After a renewal the answer holds the new expiry, because Better Auth answers with the updated session.
3. **Client** (`packages/client/src/query-state.ts`, inside `createSessionGate`):

   ```ts
   /** The longest delay a timer takes; a longer one fires at once. */
   const MAX_TIMER_MS = 2_147_483_647;
   /** How long after the expiry to read, so the server's clock has passed it too. */
   const EXPIRY_MARGIN_MS = 1000;

   let expiryTimer: ReturnType<typeof setTimeout> | undefined;
   /** The expiry the timer is set for, or last fired for. */
   let watched: string | null = null;

   const arm = (at: number) => {
     const wait = at + EXPIRY_MARGIN_MS - Date.now();
     expiryTimer = setTimeout(
       () => {
         if (wait > MAX_TIMER_MS) arm(at);
         else void refresh();
       },
       Math.min(Math.max(wait, 0), MAX_TIMER_MS),
     );
   };
   const watchExpiry = (session: AppSession | null) => {
     const expiresAt = session?.expiresAt ?? null;
     if (expiresAt === watched) return;
     watched = expiresAt;
     clearTimeout(expiryTimer);
     if (expiresAt !== null) arm(Date.parse(expiresAt));
   };
   ```

   `accept` calls `watchExpiry(session)` on every session it is given, changed user or not, and so does the `existing` branch (`:205-206`). `dispose` clears the timer. The shape may change to meet the size limits; the behaviour to keep:
   - **One timer, for the newest expiry.** Every session read (focus, reconnect, a settle, another tab's message) brings the current value; a different value replaces the timer.
   - **No loop.** A read at the expiry that answers with the same `expiresAt` (the device's clock is ahead of the server's) sets no new timer. The page is then where it is today: the next focus, reconnect or refused call settles it.
   - **Signed out clears it.** `accept(null)`, including `confirmSignedOut`, leaves no timer.
   - **A long session.** A delay beyond the limit is waited for in steps without reading; the default seven days is under it, a project's 30 days is not.
   - **A failed read** at the expiry (offline) sets no timer; reconnect and focus re-read as they do today.
   - What the read finds is handled by what exists: `null` purges and the signed-in layouts leave (rule 2); a later expiry re-arms.
4. **Module comment and docs:** add rule 7 to the list at the top of `query-state.ts` and to `docs/client.md`: "The session is read again when it expires."

### What constructs or pins an `AppSession`, and must gain the field

- Server: `toAppSession` and its callers above; tests `apps/server/src/auth/instance.test.ts` (`toAppSession`, `sessionOf`, `signedInOf`, `readSessionOf`), `apps/server/src/http/routes.test.ts:708-715`, and whatever else typecheck names among `session-actor.test.ts`, `handlers.test.ts`, `profile.test.ts` and `admin-users.test.ts`.
- Contracts: `packages/contracts/src/contracts.test.ts:29-41` pins the exact field list.
- Client: `packages/client/src/testing/fake-backend.ts:86-96` (`sessionOf`; give `FakeUser` or the backend a settable expiry so tests can move it) and `:109-112`, where `profileOf` spreads the session into a `Profile` and must stop carrying `expiresAt` along; the `user()` helper in `packages/client/src/query-state.test.tsx:21`; the fixture in `packages/client/src/session.test.tsx:16-23`.
- Web and mobile: `apps/web/src/routes/states.test.tsx`, `apps/mobile/src/screens/states.test.tsx` and any other fixture typecheck names. No source file in either app builds a session.
- Docs that list the fields: `docs/auth.md:20`; check `docs/client.md` and `docs/adr/002-better-auth-behind-an-allow-list.md` for a list.

### Failing tests first

- `packages/contracts/src/contracts.test.ts`: the field list includes `expiresAt`; a session without it does not decode.
- `apps/server/src/auth/instance.test.ts`: `toAppSession` and `readSessionOf` carry the session's `expiresAt` as an ISO string, from a `Date` and from a string.
- `apps/server/src/auth/auth-flow.live.test.ts`, in "session renewal" (`:193`): before the row is aged, the route's `expiresAt` equals the row's `expires_at`; after the renewing read, the answer's `expiresAt` equals the row's new `expires_at`, not the old one.
- `packages/client/src/query-state.test.tsx`, with Vitest's fake timers (no test in `packages/client` uses them yet; advance with `vi.advanceTimersByTimeAsync` so the query's promises settle):
  1. "reads the session again when it expires": a session expiring in 60 seconds; no session request at 59 seconds; one more just after 61; the backend answers `null`; `gate.current()` is `null` and a protected query is gone.
  2. "follows a renewed expiry": a second read brings a later `expiresAt`; nothing is read at the first moment, one read at the second.
  3. "does not read again when the server still reports the same expiry".
  4. "waits out an expiry beyond the timer's limit without reading early" (30 days).
  5. "sets no timer once signed out, and none after dispose".
  Before the change, test 1 fails because no request is made.
- The web and mobile screens need no new test: `apps/web/src/routes/guards.test.tsx` and the mobile equivalents already cover leaving a page when the session becomes `null`.

### Not verified

- That a `setTimeout` of seven days fires on time on a phone. React Native 0.88.1's `JSTimers.js` has no long-timer warning (searched), but timers do not run while the app is in the background; returning to the foreground re-reads the session through the focus manager, which covers that case.
- A browser that suspends the tab or the machine fires the timer late; focus covers the wake-up.

### For a project made from the base

- `AppSession` has a new required field: every fixture and any code that builds one must add `expiresAt`, and `toAppSession` takes a second argument.
- A mobile build with this change needs a server with it, or the session fails to decode. An older mobile build keeps working against a newer server, since an extra field is ignored. Deploy the server first.

## 7. Item 2 (F47): rename a passkey

### What exists

- **The route is exposed:** `apps/server/src/auth/allowed-routes.ts:41`, `route("POST", "/passkey/update-passkey", "Rename a passkey.")`.
- **What it accepts** (`@better-auth/passkey/dist/index.mjs:710-762`): a body `{ id: string, name: string }`, the name trimmed and at least one character; a session is required and the passkey must be the caller's (otherwise `PASSKEY_NOT_FOUND`, or 401). It answers `{ passkey }`. **It has no maximum length and does not refuse a NUL**, which Postgres cannot store, so such a name would fail in the database. The name given when a passkey is added arrives the same way, as `name` in the body of `POST /passkey/verify-registration` (`dist/client.mjs:92-99`), with no rule beyond a trim.
- **The client method exists:** `client.passkey.updatePasskey` (path-derived, as `deletePasskey` is). `WebAuth` (`apps/web/src/lib/auth.ts:29-37`) does not wrap it yet.
- **The mobile app shows no passkeys** (`apps/mobile/src/screens/profile.tsx:81`; `docs/mobile-dev.md`, "Passkeys on mobile: not implemented"). This item is web only.
- **How the profile page works today** (`apps/web/src/routes/profile.tsx`), which the rename follows:
  - Adding and removing go through one helper, `change` (`:185-196`): it runs the action through `gate.settle`, **reads the list again whatever happened**, and then shows one message: done (success `Notice`), the server's refusal (`errorMessageKey` in the `errors` namespace), or `UnknownOutcome` when no answer arrived (`PasskeyNotice`, `:154-167`).
  - `usePending` (`:178`) makes a second press a no-op and reports an unexpected throw (`Unexpected`); `busy` (`:115`, `:182`) says which button shows its pending label while every other button is disabled.
  - `usePasskeyLabels` (`:99-112`) gives each remove button a unique accessible name, numbered where two would match.
  - The name form (`:33-71`) shows the pattern for a field: `noValidate`, validate on submit, the error on the `Field`, and `useFocusAfterRender` to focus the field once its error is on screen.

### The change

1. **Name rule: the display-name rule** (trimmed, 1 to 100 characters, no NUL), so the base has one rule for names (decision D3).
   - `packages/client/src/validation.ts`: `validatePasskeyName(input)`, sharing its body with `validateName` (after item 4) and differing only in the key for an empty name, `"validation.passkeyNameRequired"`, added to `FieldError`.
   - **Server (decision D2):** hold `name` to the same rule in the body of `POST /passkey/update-passkey` and `POST /passkey/verify-registration`, in a Better Auth `hooks.before` middleware in `buildAuthOptions` (`apps/server/src/auth/options.ts`; `createAuthMiddleware` is exported by `better-auth/api`, from which the file already imports `APIError`). A name that breaks the rule gets the same 400 `INVALID_NAME` as a user's name; an absent name on registration passes. `databaseHooks` cannot do this: it covers Better Auth's own models, not a plugin's. **Not verified:** that a `before` hook sees the path and the parsed body of a plugin's endpoint as `ctx.path` and `ctx.body` in 1.7.25. Write the live test first; if the hook cannot do it, keep the client rule, say in `docs/auth.md` that the server takes any non-empty passkey name, and record it in section 11.
2. **`apps/web/src/lib/auth.ts`:** `WebAuth` gains
   `readonly renamePasskey: (id: string, name: string) => Promise<AuthResult>`, implemented as
   `run((fetchOptions) => client.passkey.updatePasskey({ id, name, fetchOptions }))`.
3. **`packages/client/src/testing/fake-backend.ts`:** a `"POST /passkey/update-passkey"` handler beside `deletePasskey` (`:247-252`): 401 without a user, 404 with the code `PASSKEY_NOT_FOUND` for an unknown id, otherwise it sets the name and answers `{ passkey }`.
4. **`apps/web/src/routes/profile.tsx`:**
   - Each row gets a secondary "Rename" button before "Remove", with a unique accessible name from `usePasskeyLabels` (a `renameLabel` built as `removeLabel` is).
   - Pressing it replaces that row's name and date with a small form: a `Field` labelled "Passkey name" holding the current name (empty for an unnamed passkey), "Save" and "Cancel". The field takes focus when it appears (`useFocusAfterRender`). One row is edited at a time: `editing: string | null` in `Passkeys`.
   - Submit validates with `validatePasskeyName`. Invalid: the error on the field, focus to the field. Equal to the current name: the form closes and nothing is sent. Otherwise: `change({ kind: "rename", id }, () => auth.renamePasskey(id, name), t("passkeys.renamed"))`, with `PasskeyBusy` gaining the `rename` kind, "Save" showing "Saving…" and every other button disabled, as for remove.
   - Afterwards, as `change` already does: the list is read again, then one message. On success the form closes and focus goes to that row's "Rename" button. On a refusal the form stays open with the error notice. On an unknown outcome the form closes and `UnknownOutcome` is shown; the list that was just read is the truth.
   - "Cancel" closes the form and returns focus to the row's "Rename" button.
   - `change` must tell its caller how it ended, so the row knows whether to close; return the kind rather than adding state.
   - Split by the size limits: a `PasskeyRow` and a `RenamePasskeyForm` component; `PasskeyList` passes `editing`, `onEdit`, `onRename` and `onCancel` through. A component takes one props object, so the four-parameter limit is not in the way.
5. **New strings** (`packages/i18n/src/locales/en.ts`):
   - `profile.passkeys.rename`: "Rename"
   - `profile.passkeys.renameLabel`: "Rename passkey {{name}}, added {{date}}"
   - `profile.passkeys.renameLabelNumbered`: "Rename passkey {{name}}, added {{date}} ({{number}})"
   - `profile.passkeys.nameLabel`: "Passkey name"
   - `profile.passkeys.saveName`: "Save"
   - `profile.passkeys.savingName`: "Saving…"
   - `profile.passkeys.cancelRename`: "Cancel"
   - `profile.passkeys.renamed`: "Passkey renamed."
   - `auth.validation.passkeyNameRequired`: "Enter a name for the passkey."
   - Reused: `auth.validation.nameTooLong`, `auth.validation.nameInvalid` and `errors.betterAuth.INVALID_NAME` from item 4, and `errors.betterAuth.PASSKEY_NOT_FOUND`, which exists.

### Failing tests first

- `packages/client/src/validation.test.ts`: `validatePasskeyName` trims, and reports empty, 101 characters and a NUL each with its own key.
- `apps/web/src/lib/auth.test.ts`: `renamePasskey` posts `{ id, name }` to `/api/auth/passkey/update-passkey`; a refusal is a failure result; no answer throws `NetworkError`.
- `apps/web/src/routes/signed-in.test.tsx`, beside "lists passkeys and removes one" (`:185`):
  1. renames a passkey: the field holds the old name and has focus; after "Save" the list shows the new name, "Passkey renamed." is shown, the list was read again, and focus is on the row's "Rename" button;
  2. an empty or over-long name shows its error on the field, focuses it, and sends nothing;
  3. "Cancel" sends nothing and returns focus;
  4. a refusal (`PASSKEY_NOT_FOUND`, the passkey removed in another tab) shows its message and the list is read again;
  5. no answer shows the unknown-outcome notice and the list as the server has it;
  6. two passkeys with the same name and date have different "Rename" button names;
  7. while a rename runs, the other buttons are disabled and a second submit does nothing.
- Server, with the hook: `apps/server/src/auth/options.test.ts` for the rule's branches, and in `apps/server/src/auth/auth-flow.live.test.ts` a signed-in `POST /api/auth/passkey/update-passkey` with a 200-character name and with a NUL answers 400 `INVALID_NAME` before any lookup of the passkey. A live test of a successful rename needs a registered passkey, which the live tests cannot make; the browser journey covers it.
- `e2e/journeys.spec.ts`, the passkey journey (`:76-119`): after "Passkey added.", rename it to "Work laptop", expect "Passkey renamed." and a "Remove passkey Work laptop, added …" button, and run the accessibility check with the form open and after it closes. The later steps match `/^Remove passkey /` and keep working.

### For a project made from the base

- `WebAuth` gains a method, so a project's own fake of it needs one. Other locales need the new keys.
- With the server rule, a passkey name longer than 100 characters or with a NUL is refused when a passkey is added or renamed; existing names are untouched.

## 8. Item 3 (L2): scroll position on Back to the user list

### What the code says

- **What scrolls** is the window. `AppShell` (`apps/web/src/components/AppShell.tsx`) is a `min-h-screen` column with no scroll container of its own, and the table's `<section>` (`apps/web/src/routes/admin-users.tsx:42`) scrolls sideways only.
- **`scrollRestoration: false` (`apps/web/src/router.tsx:45`) does not mean the router leaves scrolling alone.** `setupScrollRestoration` (`router-core/src/scroll-restoration.ts:151`) installs its `onRendered` listener whatever the option is (`:243-250`), and with nothing saved that listener calls `scrollTo({ top: 0, left: 0 })` after every navigation, Back and Forward included (`:353-362`). That is why the page is at the top on Back today; the browser's own restoration is overridden.
- **With the option on,** the router sets `history.scrollRestoration = "manual"`, notes each target that fires a scroll event, saves their positions under the leaving entry's key at `onBeforeLoad` (`:201-206`), and at `onRendered` scrolls the window to the position saved for the arriving entry (`:323-341`), **once**. The default key is the history entry's own (`location.state.__TSR_key`, else the href; `:50-52`), so Back and Forward find the entry they left. `getScrollRestorationKey` and `scrollToTopSelectors` are not needed: the first only changes the key, the second is for scroll containers other than the window.
- **The list is on screen when that one scroll happens.** `onRendered` is emitted after React has committed the new matches (`react-router/src/Matches.tsx:95-99`, `router-core/src/load-client.ts:1903-1931`). The user list's query is still cached on Back (it became inactive on leaving and nothing in this flow removes it; TanStack Query keeps an inactive query for five minutes by default, and `createServices` sets no other time), so `UserList` renders every loaded row in its first render, not `<Loading />`. Nothing on the page moves focus on arrival.
- The option's inline script is rendered only on a server (`react-router/src/Match.tsx:160-165`), so the Content-Security-Policy is not involved.

### The likely cause of what the previous attempt saw

By this reading, turning the option on should restore the position in an in-app Back. The journey's flow hides it: it leaves the list by clicking "Profile" in the header (`e2e/journeys.spec.ts:145`), and the header is at the top of the document, so the browser (and Playwright, which scrolls a link into view before clicking it) is at the top when the position is saved. Going Back then restores the top, correctly. The same holds for a person: the base has no way to leave the scrolled list inside the app except the browser's Back and Forward buttons. A project that adds a link in each row gets the benefit at once.

**This is not settled by reading.** Two other causes fit the same report and the experiment below tells them apart:

- a position is saved only for a target whose scroll event has been dispatched since the last navigation (`:191-199`, cleared at `:205` and `:256`), so a test that scrolls and navigates in the same frame saves nothing;
- a test that reads `scrollY` before `onRendered` has run sees the old value.

### The experiment to run first

Set `scrollRestoration: true` in `apps/web/src/router.tsx` and extend the journey after its present last assertion, where the list is on screen with both pages and the profile page is the next history entry:

```ts
await page.mouse.wheel(0, 400);
await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
const scrolled = await page.evaluate(() => window.scrollY);

await page.goForward(); // leaves the list without touching the header
await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
await page.goBack();

await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
await expect(rows).toHaveCount(loaded);
await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
```

Run the same steps once with the option off, to see the last line fail with 0: that is the failing test. With 26 rows or more the document is taller than the viewport on a fresh database too. If the restored value is off by a fraction of a pixel, compare within one pixel.

- **It passes with the option on:** the cause was the flow. Keep the option on and the steps; that is the fix.
- **It fails:** before the Back, wrap `window.scrollTo` in the page to record its argument and `document.documentElement.scrollHeight` at each call, and look at the call after the Back. Called with the saved position but the document too short: the list rendered after the restoration; use the fallback. Called with 0: nothing was saved; check that the wheel's scroll event reached the document before leaving, and what key the entry has.

### The fix, and the fallback

- **Fix:** `scrollRestoration: true`, the journey steps above, and the journey's comment at `e2e/journeys.spec.ts:150-151` and its title changed to say the position is restored. It applies to every page, which is what a browser does without a router.
- **Fallback, only if the list proves to render late:** keep the option on, and in `UserList` read the saved window position with the router's `useElementScrollRestoration({ getElement: () => window })` (exported by the installed version, `react-router/src/ScrollRestoration.tsx:32-49`) and call `window.scrollTo` in a layout effect the first time the rows are shown. That needs a unit test with a stubbed `scrollTo` (`apps/web/src/test/setup.ts:12` stubs it already) and no dependency.
- **Unit tests:** none can fail first; jsdom has no layout. The existing web tests keep passing with the option on: the router then also touches `sessionStorage` and `history.scrollRestoration`, which jsdom tolerates (not run; `agent:check` will show it).

### For a project made from the base

The router now restores scroll positions on Back and Forward everywhere and takes over from the browser's own restoration. A page with its own scroll container can mark it with `data-scroll-restoration-id`, or name it in `scrollToTopSelectors` to have it reset on navigation.

## 9. Decisions

The owner settled all seven on 2026-11-21, each as recommended except the wording in D7. They are fixed.

- **D1. `expiresAt` required or optional in `AppSession`?** Required. Optional would let a new mobile build talk to an older server, at the price of a branch in the client for a state the base never produces.
- **D2. Enforce the passkey name rule on the server?** Yes, in a request hook, for adding and renaming. Without it a hand-made request can store a name of any length, and one with a NUL fails in the database. It is the one part of this plan that depends on unverified library behaviour; the fallback is in section 7.
- **D3. Which rule for passkey names?** The display-name rule: 1 to 100 characters after trimming, no NUL.
- **D4. Turn the router's scroll restoration on for the whole app,** not for the list alone? Yes: it is one option, and off means the router scrolls every page to the top on Back.
- **D5. The update PR's wording:** "`<name>` stays at `<kept>`, not `<refused>`: `<reason>`".
- **D6. Run the rename through `gate.settle`,** like add and remove? Yes. It costs one session read per rename and keeps one path, with the unknown-outcome handling, for every passkey action.
- **D7. The two new messages** for a name the rules refuse (section 5). The owner's wording: the message for a character that cannot be used names the character, and both end "Please try another name."
  - `validation.nameInvalid`: "The name contains a character that cannot be used: {{character}}. Please try another name."
  - `errors.betterAuth.INVALID_NAME`: "That name cannot be used. Please try another name."

## 10. Verification, docs and definition of done

**Gates.** `bun run agent:check` on every commit. Beyond it:

| Item | `test:live` | `build` and `smoke` | `test:e2e` | `mobile:export` | `rename:proof` |
|---|---|---|---|---|---|
| 5 | no | no | no | no | no |
| 4 | no | no | no | yes (shared client and catalog) | no |
| 1 | yes (session route, renewal) | yes | yes (every journey reads the session) | yes | no |
| 2 | yes, with the server rule | no | yes (passkey journey) | no | no |
| 3 | no | no | yes (user list journey) | no | no |

Run the four once on the final commit rather than per item. `rename:proof` is not needed: nothing here adds a name, a file the rename rewrites, or a script. For item 5, `bun run deps:update --dry-run` shows the new line if a hold applies that day; it is optional.

**Docs, in the last commit:**

- `docs/auth.md`: the session route's paragraph (`:20`) lists `expiresAt` and says the clients read the session again at that time; the passkey section (`:79`) says a passkey can be renamed and what rule its name follows; the name rule's paragraph (`:29`) mentions the passkey hook if D2 is built.
- `docs/client.md`: rule 7 of the session gate; `validatePasskeyName` where the validation helpers are described.
- `docs/quality.md` (`:151-157`): the second journey renames the passkey; the third checks the scroll position after Back; the list of checked page states gains the profile with the rename form open.
- `docs/dependencies.md`: no change; it quotes no line of the PR body.
- `CHANGELOG.md`: under "Fixed: the findings of the full-branch review", replace the "Open after this change" sentence (`:181`) with entries for the five items, each with its "for a project made from the base" note from above.
- `plans/011-review-findings.md`: its status line, the "Partly done" row of the outcome table and the "Partly done, and what is left" list point to this plan for F14, F47, L2 and the two notes; F63 stays as it is. `plans/README.md`: the status of 011 and of this plan.
- The pull request description: a short `## Follow-up: plan 012` section.

**Done when**, on the final commit:

1. From clean: frozen install and `bun run agent:check`, 100% coverage, no skipped test, no new suppression, exclusion or dependency.
2. Database up: `test:live`, `build`, `smoke`, `test:e2e`; then `mobile:export`.
3. For each item, the test that failed before the fix is named in section 11 with how it failed.
4. CI green on the head commit, all jobs.
5. The scrub check from plan 000 prints nothing.

**Risks:**

- **Fake timers and TanStack Query** in the gate's tests: the query client's own timers are faked too. Create the client inside each test and restore real timers afterwards.
- **A clock that is wrong on the device.** Ahead: one early read, then no timer (section 6). Behind: the read comes late by the difference; until then the page behaves as it does today.
- **The request hook** (D2) may not see what it needs; the fallback is named.
- **Scroll restoration** may change how other pages feel on Back; the first journey and the web tests will show anything that breaks, and the option is one line to revert.
- **The profile page** grows; keep each component under the complexity limits by splitting, not by raising a limit.

## 11. How it was built

_To be filled in by whoever implements this plan: what the code settled that the plan left open, the result of the experiment in section 8, each departure with its reason, the failing test for each item, and what was verified and how._
