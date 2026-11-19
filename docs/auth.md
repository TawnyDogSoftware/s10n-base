# Auth

How sign-up and sign-in work, how the pieces fit, and how to change them. The design and its reasons are in [plans/004-auth.md](../plans/004-auth.md).

Auth is [Better Auth](https://www.better-auth.com/) 1.7.25 on the server, with email and password (verification required), the `expo` plugin for the mobile app, the `admin` plugin and passkeys. The web app has the screens (sign-up, sign-in with a password or a passkey, email verification, password reset, profile with passkey management, an admin user list); mobile screens arrive in phase 6. How the clients keep cached data per user is in [client.md](client.md).

## How a request flows

```text
browser / app
   │
   ├── /api/auth/*          ──► route guard ──► body limit ──► Node-to-Fetch bridge ──► Better Auth
   ├── /api/app-auth/session ──► origin check ──► session lookup ──► AppSession
   └── /rpc                  ──► origin check ──► dispatcher ──(only if the method needs it)──► session lookup
```

- **Route guard** (`apps/server/src/auth/route-guard.ts`). Built from Better Auth's own endpoint inventory and matched with `better-call`, the router Better Auth uses, with the same settings, so the guard and Better Auth agree on what a path means. It runs before the body is read. Anything it does not admit gets `404 {"ok":false,"error":{"code":"http.not_found"}}` and never reaches Better Auth, so it cannot run Better Auth's middleware or create a rate-limit row.
- **Allow-list** (`apps/server/src/auth/allowed-routes.ts`). Every route Better Auth serves is listed either as exposed or as deliberately not, with a reason. The guard admits only exposed routes. A test fails when Better Auth serves a route on neither list (so an upgrade that adds an endpoint forces a decision) or when a listed route no longer exists.
- **Bridge** (`apps/server/src/http/fetch-bridge.ts`). Builds the Fetch `Request` with a URL from `APP_URL`, never from `Host`; reads the body through the same limit as `/rpc` (413); replaces any incoming copy of the internal client-IP header with the address the server resolved (`TRUSTED_PROXY_HOPS` applies); copies the response back with every `Set-Cookie` header kept separate and `Cache-Control: no-store`.
- **Session route.** `GET /api/app-auth/session` answers `{"ok":true,"data":{"session":AppSession|null}}`. `AppSession` (`packages/contracts`) is ours: `userId`, `email`, `name`, `image`, `role` (`user` or `admin`) and `emailVerified`. Clients depend on it, not on Better Auth's objects, so it stays the same when Better Auth's change. Reading the session also renews it: once a session is a day old (Better Auth's `updateAge`), Better Auth extends it to seven days from now and sets a new session cookie, which this route passes on. Without that, an active user's cookie would expire seven days after sign-in. The browser stores the renewal itself; the mobile app stores it in SecureStore (`withAuthCookie` in `apps/mobile/src/lib/auth.ts`).
- **RPC caller.** The dispatcher looks up the session only for methods whose `auth` is not `public`, and at most once per call; a handler gets the caller with `await context.getActor()`. A banned user or an expired session is anonymous.

### Exposed and unexposed routes

Exposed: email sign-up, sign-in and sign-out, the session, email verification and resending it, password reset (request and set), changing the password and the name or image, listing and ending one's own sessions, all passkey routes, and these admin routes: list and get users, set role, ban and unban, list and end a user's sessions, check a permission.

Not exposed: social sign-in and every OAuth route, Better Auth's own reset link (`GET /reset-password/:token`, since reset emails open the web page), account deletion, email change, `update-session`, `verify-password`, Better Auth's `/ok` and `/error`, and the admin routes that create users, change arbitrary user fields, set a user's password or impersonate. `/admin/remove-user` is turned off in Better Auth itself (`disabledPaths`), because removing a user needs cleanup only a product knows about.

To expose a route, move it to `EXPOSED_AUTH_ROUTES` with the reason a client needs it. To add your own guarded user removal, add an RPC method with `auth: { role: "admin" }` that does the product's cleanup and then deletes the `ba_user` row (sessions, accounts and passkeys cascade).

## Cookies and cross-site rules

- Cookies are named `s10n-base.<name>` (`AUTH_COOKIE_PREFIX` in `packages/shared/src/auth.ts`, which the mobile app's auth client reads too), `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever `APP_URL` is `https`.
- Trusted origins are `APP_URL`, the mobile app's URL scheme for the server's `APP_VARIANT` (from `packages/shared/src/app-variants.ts`), and `exp://` (Expo Go) only when `NODE_ENV` is `development`.
- `/rpc` and `/api/app-auth/*` refuse a request whose `Origin` header is not trusted, with 403 and before any work. Requests with no `Origin` (the mobile app, servers, curl) pass that check and still need a session cookie.
- `/api/auth/*` relies on Better Auth's own checks: a sign-in or sign-up that carries an `Origin`, and any request that carries a cookie, must come from a trusted origin. **Better Auth turns these checks off by default when `NODE_ENV` is `test`**; the options set `disableOriginCheck: false` and `disableCSRFCheck: false` so they are on everywhere.
- CORS allows only `APP_URL`'s origin, with `GET` and `POST` and the `content-type` header. That is all the Better Auth web client sends (it sets `credentials: "include"` and a JSON body), so auth needed no CORS change. In development the browser talks to Vite, which proxies `/api`, so requests are same-origin anyway.

## Rate limits

Better Auth's limits are on in every environment and kept in the `ba_rate_limit` table, so several server instances share one count. Its defaults apply, per client address and path: three requests per 10 seconds to sign-in, sign-up and change-password, three per 60 seconds to the routes that send email (password reset request, resending verification), and 100 per 10 seconds elsewhere. The address is the one the server resolved, passed in an internal header; set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the server, or every client behind a proxy shares one count.

## Email

Better Auth calls `AuthEmailSender` (`apps/server/src/auth/email/sender.ts`) for the verification and password reset emails; nothing else knows how email is delivered. The text is the `email` namespace of `packages/i18n` ([i18n.md](i18n.md#the-email-namespace)). Both links work for one hour.

**The links open web pages, not Better Auth's routes:** `<APP_URL>/verify-email?token=…` and `<APP_URL>/reset-password?token=…` (`authEmailLink` in `apps/server/src/auth/options.ts` builds them from the token Better Auth passes; its own `url` is not used). The page reads the token and calls Better Auth: `GET /api/auth/verify-email?token=` and `POST /api/auth/reset-password` with `{token, newPassword}`. So the client does not pass `callbackURL` or `redirectTo`, and the links work the same when the API is on another origin. The web app keeps search values as strings, so a token that looks like a number or `null` reaches Better Auth unchanged.

The sender is our own Amazon SES v2 client (`apps/server/src/infra/email/`): a SigV4 signer on `node:crypto`, verified against the AWS test suite, and one `fetch` per email. Retries happen only when SES certainly did not accept the email (a refused connection, throttling, a 5xx); a timeout is never retried, because SES has no idempotency key and a retry could send twice. Errors carry a kind (`rejected`, `not_verified`, `throttled`, `credentials`, `unavailable`) and never the keys, signature, address or link.

**Static keys only.** The client reads `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and optionally `AWS_SESSION_TOKEN`. A project that needs role assumption, SSO or instance credentials should put `@aws-sdk/client-sesv2` back behind `AuthEmailSender`: implement `sendVerificationEmail` and `sendPasswordResetEmail` with the SDK's `SendEmailCommand` and pass the sender in `apps/server/src/server.ts`.

To use another provider, implement `AuthEmailSender` the same way.

### The local inbox

`bun run ses:local` (also started by `bun dev`) runs a capture server on `SES_ENDPOINT` (`http://127.0.0.1:8005` in `.env.example`). It accepts SES v2 `SendEmail` requests signed with the placeholder keys `local`/`local` (anything else gets 403, so every local email also tests the signer), keeps the last 200 emails in memory, and serves:

- `http://127.0.0.1:8005/`: the inbox, newest first, with links clickable;
- `GET /store`: `{"emails":[...]}` for tests;
- `POST /clear-store`, `GET /health-check`.

It listens on loopback only, since the inbox has no authentication. Production refuses `SES_ENDPOINT` and the placeholder keys.

## Creating the first admin

Sign up and verify the account, then:

```bash
bun run auth:set-role you@example.com admin
```

In a deployment, run `node apps/server/dist/set-role.mjs you@example.com admin` with `DATABASE_URL` set. It refuses unknown roles and addresses no user has. The role applies to the user's next request. After that, admins can change roles through `POST /api/auth/admin/set-role`.

## Passkeys

The passkey plugin is on, with the relying-party id taken from `APP_URL`'s host and the name from the app name. Users add a passkey while signed in (`/passkey/generate-register-options`, then `/passkey/verify-registration`) and can then sign in with it. Passkeys follow the web origin, so the relying-party id changes if `APP_URL`'s host does, and existing passkeys stop working. Native mobile passkeys are an open item for phase 6.

## Database

The tables are `ba_user`, `ba_session`, `ba_account`, `ba_verification`, `ba_rate_limit` and `ba_passkey`, created by migration `001_auth` with snake_case columns and `uuid` keys. Deleting a user deletes their sessions, accounts and passkeys, and the sessions they started by impersonating someone. `auth/schema.live.test.ts` compares the migrated tables with Better Auth's schema for our exact options, both ways; when it fails after an upgrade or an options change, write a new migration to match.

## Upgrading Better Auth

`better-auth`, `@better-auth/expo` and `@better-auth/passkey` are released together and must stay on one exact version. `better-call` must equal the exact version `better-auth` depends on (a test checks), since the route guard uses it directly. Move all four in one change, then run `bun run test` (the allow-list test reports new routes) and `bun run test:live` (the schema test reports new columns). Read Better Auth's changelog for changes to defaults that depend on `NODE_ENV`.

## Recipes

### Organizations

Add the `organization` plugin from `better-auth/plugins` to `buildAuthOptions`, with `schema` mapping its models to `ba_organization`, `ba_member` and `ba_invitation` and every field to snake_case, as `AUTH_TABLES` does for the core tables. Write a migration for the three tables (the schema test tells you what Better Auth expects), then decide each new route in `allowed-routes.ts`. Prefer RPC methods for membership changes that need product rules, and keep the plugin's routes unexposed.

### Social sign-in

Add `socialProviders` (for example `google: { clientId, clientSecret }`) to `buildAuthOptions`, with the secrets as new config variables. Expose `POST /sign-in/social` and `GET /callback/:id` (and `POST /callback/:id` for providers that post back, such as Apple) in `allowed-routes.ts`, and for the mobile app `GET /expo-authorization-proxy`. Add the provider's redirect URL, `<APP_URL>/api/auth/callback/<provider>`, in the provider's console. Decide on account linking (`account.accountLinking`) before launch: linking by email trusts the provider's email verification.

## Pitfalls our projects' reviews found

- **Read the clock after taking row locks, not before.** An expiry or "signed in recently" check that reads `now()` before waiting for a lock judges a moment that has passed.
- **Recheck the session inside a transaction that acts on its authority.** A session can be revoked between the check at the start of a request and the write; check it again inside the transaction that relies on it.
- **Treat a lost response to a security action as an unknown outcome, not a failure.** If sign-out, a password change or a revocation times out on the client, it may have happened. Re-read the state before telling the user it failed. **As implemented in the web app:** every security action (sign-up, sign-in with a password or a passkey, sign-out, email verification, password reset and its request, adding or removing a passkey) runs through `gate.settle` from `@s10n-base/client/query-state`, which re-reads the session afterwards, even while the browser reports offline. A request with no answer, one whose connection drops while its body is read, or a proxy's 502 to 504 is a `NetworkError`; the Better Auth adapters (`runAuthAction` in `@s10n-base/client/auth`, used by the web and mobile apps) detect one even when Better Auth's passkey client reports it as a cancellation. The screen then says the result is not known and what the session is now, and acts on that session: a sign-in that did happen goes on, a sign-out that did happen goes to `/sign-in`, and a passkey list is read again. See [client.md](client.md#session-gated-query-state).
- **Clean up after a failed multi-step security action.** If a project adds steps around password reset (or any action that creates sessions), make sure a session created by an attempt that then fails is revoked, not left behind.
