# The client package

`packages/client` (`@s10n-base/client`) is how the web and mobile apps talk to the server: an RPC client, a session client, session-gated query state on TanStack Query, and the helpers both apps' screens share. It imports `contracts`, `shared` (the auth cookie prefix, for the test server) and `i18n` (message keys), and `effect`; `react` and `@tanstack/react-query` are peer dependencies. Import from its subpaths; there is no barrel:

| Import                                   | What it has                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@s10n-base/client/rpc`                  | `createRpcClient`, the three failure classes, `parseBaseUrl`                                                                                     |
| `@s10n-base/client/session`              | `createSessionClient`, `sessionQueryOptions`, `useSession`, `SESSION_QUERY_KEY`                                                                  |
| `@s10n-base/client/query-state`          | `createSessionGate`, `SessionGateProvider`, `useProtectedQuery`, `protectedQueryKey`, `StaleSessionError`, `browserSessionChannel`, `useRecheck` |
| `@s10n-base/client/auth`                 | `AuthResult`, `PasswordAuth`, `runAuthAction` and `lostAnswerFetch`: a Better Auth client's results as data, a lost answer as `NetworkError`     |
| `@s10n-base/client/user-list`            | `useUserList`: the admin user list's query, a page at a time, and what to do when the last page arrives                                          |
| `@s10n-base/client/validation`           | The form fields' checks (name from the contract, email, password within Better Auth's limits) and `fieldErrorText`                               |
| `@s10n-base/client/messages`             | `errorMessageKey`: the `errors` message for any failure a screen shows                                                                           |
| `@s10n-base/client/form`                 | `checkFields`: checks a form's fields together; `useFocusAfterRender`: focuses the first invalid one once its error is shown                     |
| `@s10n-base/client/profile-name`         | `useProfileNameForm`: the profile name form's draft, save and notices, shared by both apps                                                       |
| `@s10n-base/client/use-pending`          | `usePending`: pending state for one action, ignoring a second press while it runs, and whether it threw                                          |
| `@s10n-base/client/testing/fake-backend` | Test code only: an in-memory server for both apps' screen tests                                                                                  |

## The base URL

Every client takes an explicit `baseUrl`, the API's origin (`https://api.example.com`, no path). A relative URL works only in a browser on the same origin as the API, never in a native app. The web app passes `VITE_API_BASE_URL`, or its own origin when that is unset ([setup](setup.md#environment-variables)). Requests send cookies (`credentials: "include"`) unless you pass another `credentials` mode.

A native app has no cookie jar. The mobile app passes `credentials: "omit"` and a `fetch` that adds the session cookie Better Auth's Expo client keeps in SecureStore (`withAuthCookie` in `apps/mobile/src/lib/auth.ts`); the session gate and its rules are the same.

## The RPC client and its three failures

```ts
const rpc = createRpcClient({ baseUrl });
const profile = await rpc.call(profileGet, {}, { signal });
```

`call` encodes the payload with the method's contract before anything is sent (a payload the contract rejects throws without a request), posts `{method, payload}` to `<baseUrl>/rpc`, and decodes the result with the contract. It fails in one of three ways, and they mean different things:

| Error          | What happened                                                                                                                                                              | What to do                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `RpcError`     | The server answered `{ok: false, error}`: it handled the call and refused it. Carries `code` (one of `ERROR_CODES`) and the HTTP `status`.                                 | Show the message for the code (`errors` namespace in `packages/i18n`).                |
| `DecodeError`  | Something answered, but not in the contract's shape, or with a status that disagrees with its envelope: a client and server out of step, or a page that is not our server. | Show a generic error; the request may have been handled.                              |
| `NetworkError` | **No answer**: the connection failed or dropped, or a proxy answered 502, 503 or 504, whatever its body. **The outcome is unknown**: the server may have done it.          | Re-read the state before saying it failed. Never retry a non-idempotent call blindly. |

An aborted call (its `signal` fired) rejects with the abort error itself, not a `NetworkError`. A call that has not finished, headers and body, within its deadline (`timeoutMs`, 30 seconds by default, for the RPC and the session clients alike) is abandoned as a `NetworkError`: the server may still have done it. The auth adapters have no deadline, since a passkey prompt waits on the person.

## Session-gated query state

Cached server data belongs to the user who was signed in when it was fetched. `createSessionGate({queryClient, sessionClient, channel})` watches the session query and enforces six rules:

1. **Protected queries carry the user's id.** `useProtectedQuery(parts, fetcher)` (or `gate.protectedQueryOptions(session, parts, fetcher)`) uses the key `["user", userId, ...parts]` and is disabled while signed out. A component rendering for one user cannot read another user's data, even if a purge were late.
2. **A change of user purges.** When the session's user or role changes, including to signed out, the gate cancels in-flight queries, then removes every query and mutation not marked public (`meta: PUBLIC_META`). The session query itself is always kept. This happens synchronously, inside the cache update that installed the new session, before React hears of it.
3. **A late answer is discarded.** A protected query, or a call wrapped in `gate.guard(...)`, that started under one user and finishes under another rejects with `StaleSessionError` instead of returning data.
4. **`auth.unauthenticated` and `auth.forbidden` re-read the session.** If a protected call is refused because the session ended or the role no longer allows it, the gate reads the session again. A session that is gone is a sign-out, and a changed role a change of user, so rule 2 applies. A 403 never signs anyone out by itself.
5. **Security actions settle by re-reading.** Run sign-in, sign-out, sign-up, password reset and passkey changes through `gate.settle(action)`. It re-reads the session afterwards and returns `{kind: "done", value, session}`, or `{kind: "unknown", session}` when the action ended in a `NetworkError`. Trust `session`, not the action's own result: a sign-in whose answer was lost may have signed the user in. The session query uses `networkMode: "always"`, so this read runs even when the browser reports it is offline (TanStack Query would otherwise pause it). One case allows the client to decide for itself: a sign-out the server answered with success, whose answer cleared the cookie, followed by a read that failed. Then call `gate.confirmSignedOut()`, which installs "signed out" and purges as rule 2 says. A successful sign-in followed by a failed read is not signed in until a read says so; the web app reports that the server could not be reached.

6. **Other tabs hear of a change of user.** Given a `channel`, a gate that sees the user change tells the app's other tabs, and each re-reads the session at once instead of when its cached session goes stale (30 seconds). The web app passes `browserSessionChannel(name)`, a `BroadcastChannel`; the mobile app has one screen at a time and passes none.

Rule 3 compares users only on this tab. Within one tab's stale window, another tab can sign out and in as someone else, and a request this tab sends then carries the new user's cookie. So a write that acts for "the user this screen was rendered for" sends that user's id, and the server refuses it with `auth.unauthenticated` when the session's user differs, which the gate treats as a session change (rule 4). `profile.update` takes `{userId, name}` this way.

Route guards read the session with `gate.ensure()` (the cache while fresh, otherwise the server), and `useSession()` returns it in components: the `AppSession`, `null` when signed out, or `undefined` before the first read.

### Adding a protected query

For a new screen that shows the signed-in user's data:

```tsx
const { rpc } = useServices();
const { session, query } = useProtectedQuery(["orders", status], (signal) =>
  rpc.call(ordersList, { status }, { signal }),
);
```

- Put everything the data depends on after the first part of the key (`["orders", status]`); the gate adds `["user", userId]` in front.
- For `useInfiniteQuery` or a mutation, build the key with `protectedQueryKey(session, parts)` and wrap the request in `gate.guard(() => ...)`, as `useUserList` and `useProfileNameForm` in this package do.
- Data that is the same for everyone and safe to keep across users (public config, say) can be a plain query with `meta: PUBLIC_META`, from `packages/client/src/session.ts`. Nothing outside the package uses it yet, so it is not exported (the dead-code gate fails on an export nobody imports): export it from `session.ts` with the first such query. Use it sparingly: anything not marked public is purged on a change of user, which is the safe default.
- Local React state is not purged. If a component copies query data into state (a form), key it by the user id so it remounts for another user, as `NameForm` in `profile.tsx` is.
- A form over query data keeps only the user's draft in state and shows the query's value while there is none, as `useProfileNameForm` does: a value changed elsewhere then reaches an untouched field, and a save's answer never replaces what was typed after it was sent. After a save, drop the user's other cached queries that no screen shows and invalidate the rest, so no other screen shows the old value; after a `NetworkError`, read the saved value again.

### Auth calls

Each app wraps its Better Auth client's methods in `runAuthAction(fetch, (fetchOptions) => client.method({ ...input, fetchOptions }))`. The call gets a `fetch` of its own, which reads every answer whole and notes a request that got none, so whether its answer was lost is decided by its own requests alone, never by another call running at the same time. Pass `fetchOptions` to every Better Auth method you wrap; the client's default `customFetchImpl` (`lostAnswerFetch(fetch)`) covers requests a plugin sends without the call's options, such as the first request of a passkey ceremony.

## Testing

`packages/client` tests use a real `QueryClient` and a fake `fetch`. Both apps' screen tests run against an in-memory fake of the server's routes (`@s10n-base/client/testing/fake-backend`), which can hold an answer or make a request fail with or without the server having handled it. By default one user is signed in per fake server, as a browser's cookie jar would have it; with `{cookies: true}` sign-in answers with a session cookie and each request is authenticated by the cookie it carries, which is how the mobile app's tests run.
