import { afterEach, describe, expect, it, vi } from "vitest";

import { NetworkError } from "@s10n-base/client/rpc";
import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { createWebAuth } from "./auth";

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
  return { fetch: fetch, requests };
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

  it("reports a call's own answer when an overlapping call loses its answer", async () => {
    const backend = createFakeBackend({ origin: BASE });
    backend.addUser({ email: "sam@example.com" });
    const auth = createWebAuth({ baseUrl: BASE, fetch: backend.fetch });
    const release = backend.hold("/api/auth/sign-in/email");
    backend.failNext("/api/auth/passkey/list-user-passkeys", { kind: "network" });

    const signIn = auth.signIn({ email: "sam@example.com", password: "correct horse" });
    await expect(auth.listPasskeys()).rejects.toBeInstanceOf(NetworkError);
    release();

    await expect(signIn).resolves.toMatchObject({ ok: true });
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

describe("createWebAuth without a fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the browser's fetch", async () => {
    const { fetch, requests } = fake(() => ok());
    vi.stubGlobal("fetch", fetch);

    await createWebAuth({ baseUrl: BASE }).sendVerificationEmail("sam@example.com");

    expect(requests[0]?.url).toBe(`${BASE}/api/auth/send-verification-email`);
  });
});
