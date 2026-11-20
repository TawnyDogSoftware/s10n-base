# 005: Web blank slate

> Status: implemented on 2026-11-19, on branch `feature/001-strip-desktop-and-local-first` (PR #1, which carries the whole rework).

Phase 5 of [000](000-hosted-starter-rework.md). Builds on [004](004-auth.md). Source labels such as `[S6]` are resolved in the private companion's README; nothing from that directory is copied into this repo.

## 1. Goal

A web app a new project can start from: a person can sign up, verify their email, sign in with a password or a passkey, reset a password, see a signed-in home, edit their profile and manage passkeys, and an admin can see the user list (D8). Behind it, three new packages that the mobile app in phase 6 will also use: `client`, `theme` and `i18n`.

## 2. Out of scope

| Not in this phase | Owner |
|---|---|
| `apps/mobile`, Uniwind, SecureStore | Phase 6 |
| ESLint and its `no-literal-string` rule, knip, dependency-cruiser, the coverage threshold, the committed Playwright journey | Phase 7 |
| Organizations, social sign-in, change of email, account deletion, multi-factor | Recipes or left out |
| A marketing or landing page | Later recipe |

**Change to plan 000:** it lists `eslint-plugin-i18next` under phase 5, but ESLint itself arrives in phase 7 (D4). The rule moves to phase 7. This phase still ships with no hard-coded user-visible string in any component; phase 7 turns that into a gate. Update plan 000's phase 5 and phase 7 text to say so.

## 3. Dependencies added

- `i18next` and `react-i18next`, the newest the age gate allows (27.1.5 and 18.0.2 on 2026-11-18): the owner decided every app supports multiple languages.
- `apps/web` gains `better-auth` and `@better-auth/passkey` for their browser clients, at the catalog's existing exact versions.

Nothing else: no form library, no component kit, no class-name helper, no date library. Platform APIs and what is already installed cover this phase.

## 4. Server and contracts

- **RPC methods** (the first real ones; the registry and handler list stop being empty):
  - `profile.get`, auth `session`: the caller's `userId`, `name`, `email`, `image`, `role`, `emailVerified`, `createdAt`.
  - `profile.update`, auth `session`: `{name}`, trimmed, 1 to 100 characters. It must go through a path that keeps Better Auth's view of the user consistent, so the session route shows the new name at once.
  - `admin.listUsers`, auth `{role: "admin"}`: `{limit, cursor}` with `limit` 1 to 100; returns users (`id`, `name`, `email`, `role`, `emailVerified`, `banned`, `createdAt`) newest first, with keyset pagination on `(created_at, id)` and a `nextCursor`. The cursor is opaque and validated.
  - Limits live in the contract schemas, so the server and both clients share them.
- **Email links** now point at web pages under `APP_URL` (`/verify-email?token=…`, `/reset-password?token=…`) instead of Better Auth's own routes. Update the options builder and the phase 4 live tests.
- **Email text** moves from the phase 4 strings file into `packages/i18n`; delete that file.
- Live tests: each method at each auth level; `profile.update` reflected by the session route; pagination across more users than one page with no row repeated or skipped when rows share a timestamp; an invalid cursor is 400.

## 5. `packages/client`

`@s10n-base/client`, subpath exports and no barrel, usable from React on the web and React Native. Peer dependencies: `react` and `@tanstack/react-query`. It may import `contracts` and `shared` only.

- **`./rpc`:** `createRpcClient({baseUrl, fetch?, credentials?})` returning `call(contract, payload, {signal})`. The base URL is always explicit, which fixes defect 6 of plan 000 (relative URLs). It encodes the payload and decodes the result with the contract. Failures are typed and distinct: an `RpcError` (the server answered with an `AppError`; carries code and status), a `DecodeError` (the server answered something the contract rejects), and a `NetworkError` (no answer: **the outcome is unknown**, not a failure). Replaces `apps/web/src/lib/http.ts` and `apps/web/src/rpc/client.ts`, which are deleted.
- **`./session`:** fetches `GET /api/app-auth/session` and decodes `AppSession`; query options for it; `useSession()`.
- **`./query-state`:** session-gated query state. Both Project A and Project C hit stale-session bugs here; Project A's shared package and Project C's session module are the references (private README, "Phase 5"). Ours is the small version of the same idea:
  - Protected queries are created through one helper that puts the signed-in user's id in the query key and is disabled when there is no session. Data fetched for one user cannot be read by a component rendering for another, even if a purge is late.
  - When the accepted session's user changes, including to signed out: cancel in-flight queries, then remove every query and mutation that is not marked public, before anything renders for the new user.
  - A response that started under one user and finishes under another is discarded.
  - An `auth.unauthenticated` error from a protected call re-reads the session; if it is gone, that is a sign-out transition.
  - After a `NetworkError` on a mutation that changes security state (sign in, sign out, sign up, password reset, passkey add or remove), the session is re-read instead of assuming failure. The sign-out settle query runs even when the browser reports offline.
- Tests: the four rules above as failing-first tests, including the race (a slow response for user A arriving after user B is accepted), using a real `QueryClient` and fake fetch.

## 6. `packages/theme` and `packages/i18n`

- **`@s10n-base/theme`:** one Tailwind 4 token file (`theme.css`, an `@theme` block): semantic colours for light and dark (background, foreground, muted, border, primary and its foreground, danger, success), radii, and the font stack. The web app imports it; no colour or radius is written anywhere else in `apps/web`. Before fixing the format, read Uniwind's documentation for what it requires of a shared Tailwind 4 theme file, so phase 6 can consume this file unchanged; record what you found.
  - A contrast test parses the tokens and fails if any foreground and background pair that is used together is below WCAG AA (4.5:1 for text, 3:1 for borders and large text), in both modes. The test computes contrast itself from the token values.
- **`@s10n-base/i18n`** (shape from Project B `[S6]`):
  - `locales/en.ts` with namespaces (`common`, `auth`, `profile`, `admin`, `errors`, `email`); English is the only locale.
  - Typed keys through i18next's `CustomTypeOptions`, so a mistyped key fails `typecheck`. Prove it with a type-level test.
  - `createTranslator(namespace, locale)` initialised synchronously for the server's emails; a React initialiser for the apps; `resolveLocale(codes)` falling back to English.
  - `errors` maps every `AppError` code in contracts, and the Better Auth error codes the screens can receive, to a message, with a generic fallback. A test fails if a contract error code has no message.
  - A test that every locale has the same keys as English (trivial today, a guard for the second locale).

## 7. `apps/web`

- **Config:** `VITE_API_BASE_URL`, optional, validated as a bare origin; default is the page's own origin. The RPC client and the auth client both use it.
- **Auth client:** Better Auth's browser client with the passkey client plugin, created once from the base URL.
- **Routes:**

  | Path | Guard | What it does |
  |---|---|---|
  | `/sign-up` | `redirectSignedIn` | Name, email, password. On success: "check your email". |
  | `/sign-in` | `redirectSignedIn` | Email and password, or a passkey. An unverified account gets the "check your email" state, not an error. |
  | `/verify-email` | none | Reads `token`, verifies, shows success with a way on, or an expired or invalid state with a resend. |
  | `/forgot-password` | `redirectSignedIn` | Always answers the same way, whether or not the address exists. |
  | `/reset-password` | none | Reads `token`, sets a new password, then sign-in. |
  | `/` | `requireSession` | Signed-in home: greeting, links to profile and, for admins, users. |
  | `/profile` | `requireSession` | Edit name; show email and verification state; list, add and remove passkeys; sign out. |
  | `/admin/users` | `requireSession`, then role | The user list with "load more". A signed-in non-admin sees a "not allowed" page, not a redirect. |

- **Guards** are `beforeLoad` functions: `requireSession` (redirects to `/sign-in?redirect=<path>`), `redirectSignedIn` (honours a safe `redirect`). The safe-redirect check accepts only a same-origin path: it rejects absolute URLs, `//host`, backslash tricks, and anything that does not parse back to the same origin.
- **Search params:** override TanStack Router's default search parsing and serialising so values stay strings. The default turns a numeric-looking token into a number and corrupts it. Tests: tokens `123456`, `1e5`, `true`, `null` and one with `+` and `=` survive a round trip.
- **Forms:** controlled inputs; a visible label for every field; errors tied to their field with `aria-describedby` and announced; focus moves to the first error; correct `autocomplete` values (`username`, `current-password`, `new-password`, and `webauthn` where passkeys apply); buttons disabled and labelled while pending; no double submit.
- **Lost responses:** when a security action ends in a `NetworkError`, the screen says the result is not known and re-reads the session, as in section 5.
- **Components:** a small set (`Button`, `Field`, `Notice`, `Card`, `PageShell`) styled only with theme tokens. Every user-visible string comes from `packages/i18n`.
- **Layering:** `apps/web` imports `contracts`, `shared`, `client`, `theme` and `i18n`, and nothing from `apps/server`.
- **Tests** (Vitest, jsdom, Testing Library, fake fetch), written first: every route's states; each guard including the redirect round trip and unsafe targets; the search-param cases; form validation and error mapping; the lost-response path; switching user purges the previous user's profile from the screen; the admin page for an admin, a non-admin and signed out.

## 8. A real browser, once

Unit tests cannot see a Content-Security-Policy violation or a cookie that is not sent. Before calling this done, run the journey once in a real headless browser against the **built** app served by the built server (so the phase 3 security headers are in force), with the local inbox: sign up, read the email, verify, sign in, edit the profile name, sign out, request a password reset, read the email, reset, sign in. Capture console errors and CSP violations; there must be none. Use a throwaway script and a browser fetched with `bunx` outside the repo; do not add Playwright to the repo (phase 7 does that) and do not commit the script. If the header policy has to change for the app to work, change it deliberately in the server with a test, and say what changed and why. If no browser can be run on this machine, say so plainly; do not describe the journey as verified.

Passkeys in that run: registering and using one needs a virtual authenticator. Try it through the browser's developer protocol; if it works, record it, and if not, say that passkey sign-in on web is covered by component tests only until phase 7.

## 9. Docs

- `docs/client.md`: the RPC client's three failure kinds, the session-gated query state and its rules, and how to add a protected query.
- `docs/i18n.md`: adding a string, adding a locale, the email namespace.
- `docs/auth.md`: the email links now land on web pages; the lost-response rule as implemented.
- `docs/setup.md`, `README.md`: `VITE_API_BASE_URL`; what you see after `bun dev`; how to make yourself an admin and open the user list.
- `CHANGELOG.md`: an entry.
- `plans/000-hosted-starter-rework.md`: status line; defect 6 fixed; the lint-rule move from section 2.

## 10. Verification and definition of done

On the final commit, recorded in section 11 and the PR description:

1. From clean, database stopped: frozen install, `fmt:check`, `lint`, `typecheck`, `test`, `build`.
2. Database up: `db:migrate`, `db:generate:check`, `test:live`, `smoke`.
3. The browser run of section 8, with what was and was not covered.
4. A mistyped i18n key fails `typecheck` (show the error from the type-level test).
5. `git grep` shows no relative `fetch("/…")` in `apps/web/src` outside tests, and no colour literal in `apps/web/src`.
6. `bun audit`, and the packages the lockfile gained.
7. CI green on the head commit.
8. The scrub check from plan 000 prints nothing. User-visible copy is our own and describes nothing but a generic starter.

Done when sections 4 to 9 are in, the above passes, nothing in section 2 was touched, and section 11 records versions, what Uniwind needs from the theme file, and every departure with its reason.

## 11. How it was built

Implemented on 2026-11-19 on Node 26.13.1 and bun 1.4.4, with Docker for the local Postgres. Registry data was read the same day.

### Dependency versions

| Package | Version | Published | Where |
| --- | --- | --- | --- |
| `i18next` | `^27.1.3` | 2026-11-16 | `packages/i18n` dependency, server dependency (the bundle keeps it external) |
| `react-i18next` | `^18.0.2` | 2026-11-16 | `apps/web` dependency, `packages/i18n` peer |
| `better-auth`, `@better-auth/passkey` | `1.7.25` (catalog) | 2026-11-14 | `apps/web` dependencies, for the browser client and its passkey plugin |

Section 3 expected `i18next` 27.1.5: 27.1.4 and 27.1.5 were published on 2026-11-17, so on 2026-11-19 the 3-day rule allows 27.1.3; bun picked it from `^27.1.3` on its own. The lockfile gained three third-party packages (`i18next`, `react-i18next` and its dependency `html-parse-stringify`) and the three workspace packages; everything Better Auth's browser client needs (`@better-fetch/fetch`, `nanostores`, `@simplewebauthn/browser`) was already there for the server. `bun audit`: no vulnerabilities (333 packages). Nothing else was added: no form library, component kit, class-name helper, date library or user-event library.

### What Uniwind needs from the theme file

Read from Uniwind's documentation on 2026-11-19 (`docs.uniwind.dev`: theming basics, custom themes, global CSS, quickstart, monorepos) and from the 1.14.0 package; Uniwind itself was not installed or run, which is phase 6's job.

- **Per-mode values go in `@layer theme { :root { @variant light { … } @variant dark { … } } }`**, and **every theme must define the same variables** (Uniwind warns in development when one is missing). `theme.css` does exactly that, and the test checks both modes have the same eight colours.
- **`@theme` holds design tokens** (radii, fonts, and colours used for utilities). The docs warn that `@theme` variables only customise utility classes. On the web, Tailwind generates `bg-primary` and friends only from `@theme` variables, so `theme.css` also declares every colour in `@theme` with its light value; a test checks the two agree. Whether Uniwind accepts a colour declared in both places is not documented, so phase 6 must confirm it on a device.
- **Colours are hex**, which the docs show (along with OKLCH). The contrast test needs hex anyway.
- **The `light` variant:** Uniwind defines `light` and `dark` itself. Tailwind on the web knows only `dark` (as `prefers-color-scheme: dark`), so `apps/web/src/index.css` defines `@custom-variant light (@media (prefers-color-scheme: light))`. The theme file does not define it, so it does not clash with Uniwind's.
- **Importing the file from another package** (`@import "@s10n-base/theme/theme.css"`) is not documented. The monorepos page covers only `@source` for scanning class names in shared packages. The metro config's `cssEntryFile` must be a relative path to the app's own CSS file, which then imports the theme. Phase 6 must check that the import resolves under Metro, and the monorepos page says a package that depends on free `uniwind` needs Uniwind Pro 1.8.0 or later in the app, which matters if a shared UI package is ever added.
- **Fonts and radii in React Native:** the docs show `--radius-*` in `@theme` but say nothing about font stacks; a CSS fallback list such as `--font-sans` has no meaning on a phone, so phase 6 will likely override `--font-sans` with a single family.
- **`--color-*: initial`** clears Tailwind's default palette so that only the theme's colours exist. Uniwind's handling of it is not documented; if it objects, phase 6 can move that line into the web app's CSS.

### Departures from this plan, with reasons

- **Email links are built from the token** (`authEmailLink` in `apps/server/src/auth/options.ts`): `<APP_URL>/verify-email?token=…` and `<APP_URL>/reset-password?token=…`. Better Auth's own `url` is ignored, so the client never passes `callbackURL` or `redirectTo` (plan 004's note), and `GET /api/auth/reset-password/:token`, which only redirected to the web page, moved to the unexposed list.
- **`profile.update` goes through `internalAdapter.updateUser`** on Better Auth's context, which runs Better Auth's user hooks and refreshes any session storage. Cookie caching is off, so the session route reads the user row each time; the live test shows the new name at once.
- **A new error code, `rpc.invalid_cursor`** (400), so an invalid cursor has its own message instead of the generic payload error. The cursor is base64url JSON of the last row's `created_at`, formatted by Postgres with microseconds, and its id: a JavaScript `Date` would round to milliseconds and could skip or repeat users created in the same millisecond.
- **The gate purges on a change of role too**, not only of user, so an admin demoted to user loses the admin list's cached pages. The session query is never purged, whatever its `meta`: `setQueryData` creates it without one.
- **Better Auth's passkey client swallows network failures.** Its sign-in turns any error from its last request into `AUTH_CANCELLED`, and its registration turns one into `UNKNOWN_ERROR`. So the adapter counts requests that got no answer in the `fetch` it hands Better Auth, and reports a `NetworkError` when one failed during the call, whatever the client returned. Every security action also trusts the session read afterwards, not the action's own result.
- **A proxy's 502, 503 or 504 without our envelope is a `NetworkError`**, in the RPC client and the auth adapter: the request may have reached the server, so the outcome is unknown.
- **`apps/web/src/config.ts` imports nothing.** `vite.config.ts` calls it to fail the build on a bad `VITE_API_BASE_URL`, and Vite loads its config through Node, which cannot load the workspace packages' TypeScript source (`ERR_MODULE_NOT_FOUND`, the same cause as plan 000's defect 1). The origin check is written out there rather than imported from `packages/client`.
  - _2026-11-20 (plan 011):_ no longer so. `apps/web/src/config.ts` now imports `parseBareOrigin` from `@s10n-base/shared/origin`, a file that itself imports nothing, so Vite loads it with the config; `vite.config.ts` likewise imports `@s10n-base/shared/web-dev-server` for where the dev server listens.
- **The signed-in layout does not navigate.** Its first version rendered `<Navigate to="/sign-in" search={{redirect: location.href}}>` when the session became null. After signing out, the location was already the pending `/sign-in`, so it redirected to `/sign-in?redirect=/sign-in`, then again, until the test worker ran out of memory. It now calls `router.invalidate()`, and `requireSession` redirects from the location the guard matched. The sign-out tests cover it.
- **Search parsing:** a literal `+` stays `+` (our links percent-encode, so a `+` came from a token), the first of repeated keys wins, the result has no prototype, and writing anything but a string, number or boolean throws.
- **`/` sends a signed-out visitor to `/sign-in`** without a `redirect`, since home is where sign-in goes anyway.
- **`/forgot-password`** shows the same "check your email" answer whatever the server says, except for a rate limit or a lost answer, neither of which reveals whether the address exists.
- **A confirmed sign-out stands even if the read after it fails** (`gate.confirmSignedOut()`, added in the first review round): the server's answer cleared the cookie, so leaving the signed-in screens up would show a state the server has already ended. A successful sign-in followed by a failed read shows "could not reach the server" instead of nothing.
- **Security actions do not use `useMutation`.** Each screen runs its action through `gate.settle` with a small `usePending` hook that also ignores a second submit before React has re-rendered the disabled button. The profile name uses `useMutation` with a protected key, since it is not a security action.
- **The footer no longer shows the version**, which the old app read from `/config` with a relative URL. The `/config` endpoint and its contract remain; nothing in the web app needs them now.
- **The page has an empty `data:` icon**: the browser run found one console error on every page, a 404 for `/favicon.ico`.
- **`@s10n-base/i18n/react`** holds the React initialiser, with `react-i18next` as a peer dependency, so the server imports only `i18next`.
- **The admin list loads 25 users a page** (`ADMIN_USERS_PAGE_SIZE`).
- **Web tests run the whole app** against an in-memory fake of the server's routes (`apps/web/src/test/fake-backend.ts`) with the real Better Auth browser client, rather than mocking modules.

### The browser run (section 8)

On 2026-11-19, a throwaway script (not committed) drove headless Chrome for Testing 156 through Playwright 1.65.1, installed in a scratch directory outside the repo; the browser was the one Playwright had already cached on this machine. It ran against `node apps/server/dist/bin.mjs` serving the built web app (`APP_URL=http://localhost:4210`, the phase 3 security headers and Content-Security-Policy in force) and `bun run ses:local`. Steps, all passing:

1. `/` signed out redirects to `/sign-in`; sign up; read the verification email from `/store`; open its link (`/verify-email?token=…`); sign in with the password; the cookie is `s10n-base.session_token`, `HttpOnly`, `SameSite=Lax`.
2. Edit the profile name; the greeting shows it.
3. **Passkeys, through a virtual authenticator** (Chrome DevTools Protocol `WebAuthn.addVirtualAuthenticator`, CTAP2, internal transport, resident key, user verification): add a passkey on the profile page (the authenticator then held one credential), sign out, sign in with the passkey, remove it.
4. Sign out (the session route then answers `null`); request a password reset; read the email; open its link (`/reset-password?token=…`); set a new password; the old password is refused; sign in with the new one.
5. `/admin/users` shows the not-allowed page; after `bun run auth:set-role <email> admin` it lists the user.

Observed: **no Content-Security-Policy violation** (a `securitypolicyviolation` listener on every page), no page error, no failed request, and Better Auth's client never called `/api/auth/get-session`. The console showed one error, `Failed to load resource: … 401`, which is Chrome logging the deliberate wrong-password sign-in in step 4. The first run also logged a 404 for `/favicon.ico`, fixed as above. **No header change was needed.**

### Claims in plans 000 to 005 that did not hold

- `i18next` 27.1.5 (plans 000 and 005): too young on the day; 27.1.3.
- "The default turns a numeric-looking token into a number and corrupts it": true of a raw token in a link (`123456` becomes the number 123456, `1e5` becomes 100000, `null` becomes null, `12345678901234567890` becomes 12345678901234567000), but not of TanStack Router's own round trip, which quotes such strings when it writes them. Only `1e5`, `null` and the long number change the value sent to the server; `123456` arrives as a number and happens to print back the same. The tests use all of them.
- Plan 004's note that sign-up should pass `callbackURL` and reset `redirectTo`: unnecessary once the links are built from the token.

### For later phases

- **Phase 6 (Expo):** reuse `@s10n-base/client/rpc`, `/session` and `/query-state` as they are: they take `fetch` and `credentials` options, and a native app passes the cookie through Better Auth's Expo client, so check whether `credentials: "include"` matters there. `useSession` and `useProtectedQuery` need only `SessionGateProvider`. React Native has no `BroadcastChannel` or focus events, so wire TanStack Query's `focusManager` and `onlineManager` to `AppState` and NetInfo, or the session is never re-read on return to the app. Import `createReactI18n` from `@s10n-base/i18n/react` with the device's locales. The theme points above are what to verify on a device. `apps/web/src/lib/auth.ts` is the pattern for the Expo auth adapter, including the network-failure tracking.
- **Phase 7:** the `no-literal-string` rule should find nothing in `apps/web/src`: a scan for JSX text and literal labels found only comments, and the one piece of punctuation-only JSX was removed. Coverage was not measured in this phase. For dependency-cruiser, `apps/web` imports `contracts`, `client`, `theme` (CSS only) and `i18n`, and not `shared` or anything under `apps/server`. The Playwright journey can start from section 8's steps: reuse the virtual authenticator setup, leave 10 seconds or vary `X-Forwarded-For` between more than three sign-ins from one address, and expect Chrome to log a 401 for a deliberate wrong password. The web bundle is 553 kB before gzip (176 kB gzipped) and Vite warns about chunks over 500 kB; Effect Schema, Better Auth's client and i18next are most of it, and route-level code splitting is the fix if it matters.

### Verification on the final commit (section 10)

Recorded in the pull request description (PR #1, section "Phase 5", "Tests and verification (plan 005 section 10)"), not in this file. (Corrected by phase 9: this line used to say "see below", and nothing followed.)
