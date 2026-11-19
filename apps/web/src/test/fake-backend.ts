/**
 * An in-memory stand-in for the server, behind a `fetch` the app's clients use in tests: the
 * session route, the RPC methods and the Better Auth routes the screens call, with the same
 * envelopes and error codes. Tests make any request fail with `failNext`.
 */
import type { AdminUser, AppSession, Profile } from "@s10n-base/contracts";

export const ORIGIN = "http://localhost:5173";

export interface FakeUser {
  readonly id: string;
  name: string;
  readonly email: string;
  password: string;
  verified: boolean;
  role: "user" | "admin";
  readonly createdAt: string;
  passkeys: Array<{ id: string; name: string | null; createdAt: string }>;
}

export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
}

/** How a request should fail: no answer at all, or a given answer. */
export type Failure =
  | { readonly kind: "network"; readonly afterHandling?: boolean }
  | { readonly kind: "response"; readonly status: number; readonly body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const authError = (status: number, code: string) => json({ code, message: code }, status);
const rpcError = (status: number, code: string) =>
  json({ ok: false, error: { code, message: code } }, status);

export function createFakeBackend() {
  const users = new Map<string, FakeUser>();
  /** Tokens from emails, by token: who it is for and what it does. */
  const tokens = new Map<string, { email: string; kind: "verify" | "reset" }>();
  const requests: SeenRequest[] = [];
  const failures = new Map<string, Failure>();
  let signedIn: string | null = null;
  let nextId = 1;
  /** Requests whose answers are held until the test releases them, by path. */
  const holds = new Map<string, Promise<void>>();

  const sessionOf = (user: FakeUser | undefined): AppSession | null =>
    user === undefined
      ? null
      : {
          userId: user.id,
          email: user.email,
          name: user.name,
          image: null,
          role: user.role,
          emailVerified: user.verified,
        };
  const current = () =>
    signedIn === null ? undefined : [...users.values()].find((user) => user.id === signedIn);
  const profileOf = (user: FakeUser): Profile => ({
    ...(sessionOf(user) as AppSession),
    createdAt: user.createdAt,
  });

  function addUser(input: Partial<FakeUser> & { email: string }): FakeUser {
    const user: FakeUser = {
      id: `user-${nextId++}`,
      name: "Test User",
      password: "correct horse",
      verified: true,
      role: "user",
      createdAt: new Date(Date.UTC(2026, 0, nextId)).toISOString(),
      passkeys: [],
      ...input,
    };
    users.set(user.email, user);
    return user;
  }

  function issueToken(email: string, kind: "verify" | "reset"): string {
    const token = `${kind}-${nextId++}`;
    tokens.set(token, { email, kind });
    return token;
  }

  function handleRpc(body: { method: string; payload: Record<string, unknown> }): Response {
    const user = current();
    if (user === undefined) return rpcError(401, "auth.unauthenticated");
    switch (body.method) {
      case "profile.get":
        return json({ ok: true, data: profileOf(user) });
      case "profile.update": {
        const name = String(body.payload.name).trim();
        if (name === "" || name.length > 100) return rpcError(400, "rpc.invalid_payload");
        user.name = name;
        return json({ ok: true, data: profileOf(user) });
      }
      case "admin.listUsers": {
        if (user.role !== "admin") return rpcError(403, "auth.forbidden");
        const all = [...users.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const start = typeof body.payload.cursor === "string" ? Number(body.payload.cursor) : 0;
        const limit = Number(body.payload.limit);
        const page = all.slice(start, start + limit);
        const listed: AdminUser[] = page.map((entry) => ({
          id: entry.id,
          name: entry.name,
          email: entry.email,
          role: entry.role,
          emailVerified: entry.verified,
          banned: false,
          createdAt: entry.createdAt,
        }));
        return json({
          ok: true,
          data: {
            users: listed,
            nextCursor: start + limit < all.length ? String(start + limit) : null,
          },
        });
      }
      default:
        return rpcError(404, "rpc.method_not_found");
    }
  }

  function handleAuth(
    method: string,
    path: string,
    query: URLSearchParams,
    body: Record<string, string>,
  ): Response {
    const route = `${method} ${path}`;
    switch (route) {
      case "POST /sign-up/email": {
        if (users.has(body.email ?? "")) return authError(422, "USER_ALREADY_EXISTS");
        addUser({
          email: body.email ?? "",
          name: body.name ?? "",
          password: body.password ?? "",
          verified: false,
        });
        issueToken(body.email ?? "", "verify");
        return json({ token: null, user: { email: body.email } });
      }
      case "POST /sign-in/email": {
        const user = users.get(body.email ?? "");
        if (user === undefined || user.password !== body.password) {
          return authError(401, "INVALID_EMAIL_OR_PASSWORD");
        }
        if (!user.verified) {
          issueToken(user.email, "verify");
          return authError(403, "EMAIL_NOT_VERIFIED");
        }
        signedIn = user.id;
        return json({ redirect: false, token: "t", user: { id: user.id } });
      }
      case "POST /sign-out":
        signedIn = null;
        return json({ success: true });
      case "GET /verify-email": {
        const entry = tokens.get(query.get("token") ?? "");
        if (entry?.kind !== "verify") return authError(401, "INVALID_TOKEN");
        const user = users.get(entry.email);
        if (user !== undefined) user.verified = true;
        return json({ status: true, user: null });
      }
      case "POST /send-verification-email":
        if (users.has(body.email ?? "")) issueToken(body.email ?? "", "verify");
        return json({ status: true });
      case "POST /request-password-reset":
        if (users.has(body.email ?? "")) issueToken(body.email ?? "", "reset");
        return json({ status: true, message: "sent" });
      case "POST /reset-password": {
        const entry = tokens.get(body.token ?? "");
        if (entry?.kind !== "reset") return authError(400, "INVALID_TOKEN");
        const user = users.get(entry.email);
        if (user !== undefined) user.password = body.newPassword ?? "";
        tokens.delete(body.token ?? "");
        signedIn = null;
        return json({ status: true });
      }
      case "GET /passkey/list-user-passkeys": {
        const user = current();
        return user === undefined ? authError(401, "UNAUTHORIZED") : json(user.passkeys);
      }
      case "POST /passkey/delete-passkey": {
        const user = current();
        if (user === undefined) return authError(401, "UNAUTHORIZED");
        user.passkeys = user.passkeys.filter((passkey) => passkey.id !== body.id);
        return json({ status: true });
      }
      case "GET /passkey/generate-authenticate-options":
        // No authenticator in jsdom: the browser step fails and the client reports a cancellation.
        return json({ challenge: "c", allowCredentials: [], rpId: "localhost" });
      default:
        return authError(404, "NOT_FOUND");
    }
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.clone().text();
    const body = text === "" ? undefined : (JSON.parse(text) as unknown);
    const seen = { method: request.method, path: url.pathname, search: url.search, body };
    requests.push(seen);
    const hold = holds.get(url.pathname);
    if (hold !== undefined) await hold;
    const failure = failures.get(url.pathname);
    if (failure !== undefined) {
      failures.delete(url.pathname);
      if (failure.kind === "network") {
        if (failure.afterHandling === true) answer(request.method, url, body);
        throw new TypeError("Failed to fetch");
      }
      return json(failure.body, failure.status);
    }
    return answer(request.method, url, body);
  };

  function answer(method: string, url: URL, body: unknown): Response {
    if (url.origin !== ORIGIN) throw new TypeError(`Unexpected origin ${url.origin}`);
    if (url.pathname === "/api/app-auth/session" && method === "GET") {
      return json({ ok: true, data: { session: sessionOf(current()) } });
    }
    if (url.pathname === "/rpc" && method === "POST") {
      return handleRpc(body as { method: string; payload: Record<string, unknown> });
    }
    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuth(
        method,
        url.pathname.slice("/api/auth".length),
        url.searchParams,
        (body ?? {}) as Record<string, string>,
      );
    }
    return new Response("Not Found", { status: 404 });
  }

  return {
    fetch: fetch as typeof globalThis.fetch,
    requests,
    users,
    addUser,
    issueToken,
    /** Signs a user in, as if they had done it in another tab. */
    signInAs(email: string) {
      signedIn = users.get(email)?.id ?? null;
    },
    signOutEverywhere() {
      signedIn = null;
    },
    signedInUser: () => current(),
    /** The latest unused token of a kind for an address, as the email would carry it. */
    tokenFor(email: string, kind: "verify" | "reset") {
      return [...tokens]
        .filter(([, entry]) => entry.email === email && entry.kind === kind)
        .at(-1)?.[0];
    },
    /** Makes the next request to `path` fail. */
    failNext(path: string, failure: Failure) {
      failures.set(path, failure);
    },
    /** Holds every answer to `path` until the returned function is called. */
    hold(path: string) {
      let release!: () => void;
      holds.set(
        path,
        new Promise<void>((resolve) => {
          release = () => {
            holds.delete(path);
            resolve();
          };
        }),
      );
      return release;
    },
    calls: (path: string) => requests.filter((request) => request.path === path),
  };
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;
