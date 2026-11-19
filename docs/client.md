# The client package

`packages/client` (`@s10n-base/client`) is how the web app, and the mobile app in phase 6, talk to the server: an RPC client, a session client, and session-gated query state on TanStack Query. It imports only `contracts` (and `effect`); `react` and `@tanstack/react-query` are peer dependencies. Import from its subpaths; there is no barrel:

| Import                          | What it has                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@s10n-base/client/rpc`         | `createRpcClient`, the three failure classes, `parseBaseUrl`                                              |
| `@s10n-base/client/session`     | `createSessionClient`, `sessionQueryOptions`, `useSession`, `SESSION_QUERY_KEY`, `PUBLIC_META`            |
| `@s10n-base/client/query-state` | `createSessionGate`, `SessionGateProvider`, `useProtectedQuery`, `protectedQueryKey`, `StaleSessionError` |

## The base URL

Every client takes an explicit `baseUrl`, the API's origin (`https://api.example.com`, no path). A relative URL works only in a browser on the same origin as the API, never in a native app. The web app passes `VITE_API_BASE_URL`, or its own origin when that is unset ([setup](setup.md#environment-variables)). Requests send cookies (`credentials: "include"`) unless you pass another `credentials` mode.

## The RPC client and its three failures

```ts
const rpc = createRpcClient({ baseUrl });
const profile = await rpc.call(profileGet, {}, { signal });
```

`call` encodes the payload with the method's contract before anything is sent (a payload the contract rejects throws without a request), posts `{method, payload}` to `<baseUrl>/rpc`, and decodes the result with the contract. It fails in one of three ways, and they mean different things:

| Error          | What happened                                                                                                                                  | What to do                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `RpcError`     | The server answered `{ok: false, error}`: it handled the call and refused it. Carries `code` (one of `ERROR_CODES`) and the HTTP `status`.     | Show the message for the code (`errors` namespace in `packages/i18n`).                |
| `DecodeError`  | Something answered, but not in the contract's shape: a client and server out of step, or a page that is not our server.                        | Show a generic error; the request may have been handled.                              |
| `NetworkError` | **No answer**: the connection failed or dropped, or a proxy answered 502, 503 or 504. **The outcome is unknown**: the server may have done it. | Re-read the state before saying it failed. Never retry a non-idempotent call blindly. |

An aborted call (its `signal` fired) rejects with the abort error itself, not a `NetworkError`.

## Session-gated query state

Cached server data belongs to the user who was signed in when it was fetched. `createSessionGate({queryClient, sessionClient})` watches the session query and enforces five rules:

1. **Protected queries carry the user's id.** `useProtectedQuery(parts, fetcher)` (or `gate.protectedQueryOptions(session, parts, fetcher)`) uses the key `["user", userId, ...parts]` and is disabled while signed out. A component rendering for one user cannot read another user's data, even if a purge were late.
2. **A change of user purges.** When the session's user or role changes, including to signed out, the gate cancels in-flight queries, then removes every query and mutation not marked public (`meta: PUBLIC_META`). The session query itself is always kept. This happens synchronously, inside the cache update that installed the new session, before React hears of it.
3. **A late answer is discarded.** A protected query, or a call wrapped in `gate.guard(...)`, that started under one user and finishes under another rejects with `StaleSessionError` instead of returning data.
4. **`auth.unauthenticated` re-reads the session.** If a protected call is refused because the session ended, the gate reads the session again. If it is gone, that is a sign-out, and rule 2 applies.
5. **Security actions settle by re-reading.** Run sign-in, sign-out, sign-up, password reset and passkey changes through `gate.settle(action)`. It re-reads the session afterwards and returns `{kind: "done", value, session}`, or `{kind: "unknown", session}` when the action ended in a `NetworkError`. Trust `session`, not the action's own result: a sign-in whose answer was lost may have signed the user in. The session query uses `networkMode: "always"`, so this read runs even when the browser reports it is offline (TanStack Query would otherwise pause it). One case allows the client to decide for itself: a sign-out the server answered with success, whose answer cleared the cookie, followed by a read that failed. Then call `gate.confirmSignedOut()`, which installs "signed out" and purges as rule 2 says. A successful sign-in followed by a failed read is not signed in until a read says so; the web app reports that the server could not be reached.

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
- For `useInfiniteQuery` or a mutation, build the key with `protectedQueryKey(session, parts)` and wrap the request in `gate.guard(() => ...)`, as `apps/web/src/routes/admin-users.tsx` and the name form in `profile.tsx` do.
- Data that is the same for everyone and safe to keep across users (public config, say) can be a plain query with `meta: PUBLIC_META`. Use it sparingly: anything not marked public is purged on a change of user, which is the safe default.
- Local React state is not purged. If a component copies query data into state (a form), key it by the user id so it remounts for another user, as `NameForm` in `profile.tsx` is.

## Testing

`packages/client` tests use a real `QueryClient` and a fake `fetch`. The web app's route tests render the whole app against an in-memory fake of the server's routes (`apps/web/src/test/fake-backend.ts`), which can hold an answer or make a request fail with or without the server having handled it.
