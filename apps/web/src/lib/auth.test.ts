import { describe, expect, it } from "vitest";

import { NetworkError } from "@s10n-base/client/rpc";

import { createWebAuth, runAuthAction, trackNetworkFailures } from "./auth";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly credentials: RequestCredentials | undefined;
}

function fake(answer: (seen: Seen) => Response | Promise<Response>) {
  const requests: Seen[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    const seen: Seen = {
      method: request.method,
      url: request.url,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
      credentials: init?.credentials ?? request.credentials,
    };
    requests.push(seen);
    return answer(seen);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const ok = (body: unknown = { status: true }) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const refused = (status: number, code?: string) =>
  new Response(JSON.stringify({ ...(code ? { code } : {}), message: "refused" }), {
    status,
    headers: { "content-type": "application/json" },
  });

const BASE = "https://api.example.com";

describe("createWebAuth", () => {
  it("calls Better Auth under <baseUrl>/api/auth with credentials", async () => {
    const { fetch, requests } = fake(() => ok({ token: null, user: {} }));
    const auth = createWebAuth({ baseUrl: BASE, fetch });

    await expect(
      auth.signUp({ name: "Sam", email: "sam@example.com", password: "long enough" }),
    ).resolves.toMatchObject({ ok: true });
    await auth.signIn({ email: "sam@example.com", password: "long enough" });
    await auth.signOut();
    await auth.verifyEmail("a+b=");
    await auth.sendVerificationEmail("sam@example.com");
    await auth.requestPasswordReset("sam@example.com");
    await auth.resetPassword("tok", "new password");
    await auth.deletePasskey("pk1");

    expect(requests.map(({ method, url, body }) => [method, url, body])).toEqual([
      [
        "POST",
        `${BASE}/api/auth/sign-up/email`,
        { name: "Sam", email: "sam@example.com", password: "long enough" },
      ],
      [
        "POST",
        `${BASE}/api/auth/sign-in/email`,
        { email: "sam@example.com", password: "long enough" },
      ],
      ["POST", `${BASE}/api/auth/sign-out`, {}],
      ["GET", `${BASE}/api/auth/verify-email?token=a%2Bb%3D`, undefined],
      ["POST", `${BASE}/api/auth/send-verification-email`, { email: "sam@example.com" }],
      ["POST", `${BASE}/api/auth/request-password-reset`, { email: "sam@example.com" }],
      ["POST", `${BASE}/api/auth/reset-password`, { token: "tok", newPassword: "new password" }],
      ["POST", `${BASE}/api/auth/passkey/delete-passkey`, { id: "pk1" }],
    ]);
    expect(new Set(requests.map((request) => request.credentials))).toEqual(new Set(["include"]));
  });

  it("returns a refusal with Better Auth's code and the status", async () => {
    const { fetch } = fake(() => refused(401, "INVALID_EMAIL_OR_PASSWORD"));

    await expect(
      createWebAuth({ baseUrl: BASE, fetch }).signIn({ email: "a@example.com", password: "x" }),
    ).resolves.toEqual({ ok: false, code: "INVALID_EMAIL_OR_PASSWORD", status: 401 });
  });

  it("names a rate-limited answer RATE_LIMITED", async () => {
    const { fetch } = fake(() => refused(429));

    await expect(
      createWebAuth({ baseUrl: BASE, fetch }).signIn({ email: "a@example.com", password: "x" }),
    ).resolves.toEqual({ ok: false, code: "RATE_LIMITED", status: 429 });
  });

  it("throws a NetworkError when no answer arrives", async () => {
    const auth = createWebAuth({
      baseUrl: BASE,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await expect(auth.signOut()).rejects.toBeInstanceOf(NetworkError);
    await expect(auth.signInWithPasskey()).rejects.toBeInstanceOf(NetworkError);
  });

  it.each([502, 503, 504])(
    "throws a NetworkError for a proxy's %i without a code",
    async (status) => {
      const { fetch } = fake(() => new Response("gateway", { status }));

      await expect(createWebAuth({ baseUrl: BASE, fetch }).signOut()).rejects.toBeInstanceOf(
        NetworkError,
      );
    },
  );

  it("lists passkeys as id, name and creation time", async () => {
    const { fetch, requests } = fake(() =>
      ok([
        { id: "pk1", name: "Laptop", createdAt: "2026-11-19T10:00:00.000Z", publicKey: "x" },
        { id: "pk2", name: null, createdAt: "2026-11-18T10:00:00.000Z" },
      ]),
    );

    await expect(createWebAuth({ baseUrl: BASE, fetch }).listPasskeys()).resolves.toEqual({
      ok: true,
      data: [
        { id: "pk1", name: "Laptop", createdAt: "2026-11-19T10:00:00.000Z" },
        { id: "pk2", name: null, createdAt: "2026-11-18T10:00:00.000Z" },
      ],
    });
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/auth/passkey/list-user-passkeys`,
    });
  });
});

describe("runAuthAction", () => {
  it("throws a NetworkError when a request failed even if the client turned it into a result", async () => {
    // The passkey client catches every error from its last request and reports a cancellation.
    const tracker = trackNetworkFailures(() => Promise.reject(new TypeError("Failed to fetch")));
    const swallowing = async () => {
      await tracker.fetch("https://api.example.com/x").catch(() => undefined);
      return { data: null, error: { code: "AUTH_CANCELLED", status: 400 } };
    };

    await expect(runAuthAction(tracker, swallowing)).rejects.toBeInstanceOf(NetworkError);
  });

  it("does not count an abort as a network failure", async () => {
    const tracker = trackNetworkFailures(() =>
      Promise.reject(new DOMException("aborted", "AbortError")),
    );
    const action = async () => {
      await tracker.fetch("https://api.example.com/x").catch(() => undefined);
      return { data: null, error: { code: "AUTH_CANCELLED", status: 400 } };
    };

    await expect(runAuthAction(tracker, action)).resolves.toEqual({
      ok: false,
      code: "AUTH_CANCELLED",
      status: 400,
    });
  });

  it("gives an unknown code when Better Auth sends none", async () => {
    const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));

    await expect(
      runAuthAction(tracker, () => Promise.resolve({ data: null, error: { status: 400 } })),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN", status: 400 });
  });
});
