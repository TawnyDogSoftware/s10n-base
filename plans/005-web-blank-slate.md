# 005: Web blank slate

> Status: not started.

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

Filled in by the implementor.
