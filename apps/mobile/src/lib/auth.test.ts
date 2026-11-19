import { describe, expect, it } from "vitest";

import { NetworkError } from "@s10n-base/client/rpc";
import { createFakeBackend, SESSION_COOKIE } from "@s10n-base/client/testing/fake-backend";
import { profileGet } from "@s10n-base/contracts";
import { appVariants } from "@s10n-base/shared/app-variants";

import { secureStore } from "../test/native";
import { createServices } from "../services";
import { authStoragePrefix, createMobileAuth, withAuthCookie } from "./auth";

const API = "https://api.example.com";
const SCHEME = appVariants.development.urlScheme;

function setup() {
  const backend = createFakeBackend({ origin: API, cookies: true });
  backend.addUser({ email: "sam@example.com", password: "correct horse" });
  const auth = createMobileAuth({ baseUrl: API, scheme: SCHEME, fetch: backend.fetch });
  return { backend, auth };
}

describe("authStoragePrefix", () => {
  it("gives each API origin its own keys, in characters SecureStore accepts", () => {
    const one = authStoragePrefix("https://api.example.com");
    const other = authStoragePrefix("http://192.168.1.20:4210");

    expect(one).not.toBe(other);
    for (const prefix of [one, other]) expect(prefix).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(authStoragePrefix("https://api.example.com")).toBe(one);
  });
});

describe("createMobileAuth", () => {
  it("keeps the session cookie in SecureStore under the API origin's prefix", async () => {
    const { auth } = setup();

    await expect(
      auth.signIn({ email: "sam@example.com", password: "correct horse" }),
    ).resolves.toMatchObject({ ok: true });

    const stored = secureStore.get(`${authStoragePrefix(API)}_cookie`);
    expect(stored).toContain(SESSION_COOKIE);
    await expect(auth.cookie()).resolves.toMatch(new RegExp(`^${SESSION_COOKIE}=session-\\d+$`));
  });

  it("does not use a session stored for another server", async () => {
    const { auth } = setup();
    await auth.signIn({ email: "sam@example.com", password: "correct horse" });

    const elsewhere = createMobileAuth({ baseUrl: "https://other.example.com", scheme: SCHEME });

    await expect(elsewhere.cookie()).resolves.toBe("");
  });

  it("sends the variant's scheme as the origin and calls Better Auth under /api/auth", async () => {
    const { backend, auth } = setup();

    await auth.signIn({ email: "sam@example.com", password: "correct horse" });

    expect(backend.calls("/api/auth/sign-in/email")).toHaveLength(1);
    expect(backend.headers("/api/auth/sign-in/email")?.get("expo-origin")).toBe(`${SCHEME}://`);
  });

  it("forgets the cookie on sign-out", async () => {
    const { backend, auth } = setup();
    await auth.signIn({ email: "sam@example.com", password: "correct horse" });

    await expect(auth.signOut()).resolves.toMatchObject({ ok: true });

    await expect(auth.cookie()).resolves.toBe("");
    expect(backend.liveSessions()).toBe(0);
  });

  it("returns refusals as data with Better Auth's code", async () => {
    const { auth } = setup();

    await expect(auth.signIn({ email: "sam@example.com", password: "wrong" })).resolves.toEqual({
      ok: false,
      code: "INVALID_EMAIL_OR_PASSWORD",
      status: 401,
    });
  });

  it("throws a NetworkError when no answer arrives", async () => {
    const { backend, auth } = setup();
    backend.failNext("/api/auth/sign-in/email", { kind: "network" });

    await expect(
      auth.signIn({ email: "sam@example.com", password: "correct horse" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("sends the email actions to Better Auth", async () => {
    const { backend, auth } = setup();

    await auth.signUp({ name: "Ada", email: "ada@example.com", password: "long enough" });
    await auth.sendVerificationEmail("ada@example.com");
    await auth.requestPasswordReset("ada@example.com");

    expect(backend.requests.map((request) => [request.method, request.path])).toEqual([
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/send-verification-email"],
      ["POST", "/api/auth/request-password-reset"],
    ]);
  });
});

describe("session renewal", () => {
  it("stores the renewed cookie the session route sends, so the next request carries it", async () => {
    const backend = createFakeBackend({ origin: API, cookies: true });
    backend.addUser({ email: "sam@example.com", password: "correct horse" });
    const services = createServices({ apiBaseUrl: API, scheme: SCHEME, fetch: backend.fetch });
    await services.auth.signIn({ email: "sam@example.com", password: "correct horse" });
    const before = await services.auth.cookie();

    backend.renewNextSessionRead();
    await expect(services.gate.refresh()).resolves.toMatchObject({ email: "sam@example.com" });

    const after = await services.auth.cookie();
    expect(after).not.toBe(before);
    // The old token no longer works; the stored one does.
    await expect(services.rpc.call(profileGet, {})).resolves.toMatchObject({
      email: "sam@example.com",
    });
  });

  it("ignores cookies that are not the auth cookies", async () => {
    const stored: string[] = [];
    const fetch = withAuthCookie(
      () => Promise.resolve(""),
      () => Promise.resolve(new Response("{}", { headers: { "set-cookie": "other=1; Path=/" } })),
      (header) => {
        stored.push(header);
        return Promise.resolve();
      },
    );

    await fetch(`${API}/rpc`);

    expect(stored).toEqual(["other=1; Path=/"]);
    const { auth } = setup();
    await auth.storeCookies("other=1; Path=/");
    await expect(auth.cookie()).resolves.toBe("");
  });
});

describe("withAuthCookie", () => {
  it("sends the stored cookie itself and never the platform's cookie jar", async () => {
    const seen: Array<{ cookie: string | null; credentials: RequestCredentials | undefined }> = [];
    const fetch = withAuthCookie(
      () => Promise.resolve(`${SESSION_COOKIE}=abc`),
      (input, init) => {
        seen.push({
          cookie: new Headers(init?.headers).get("cookie"),
          credentials: init?.credentials,
        });
        return Promise.resolve(new Response("{}"));
      },
    );

    await fetch(`${API}/rpc`, { method: "POST", headers: { accept: "application/json" } });

    expect(seen).toEqual([{ cookie: `${SESSION_COOKIE}=abc`, credentials: "omit" }]);
  });

  it("sends no cookie header when signed out", async () => {
    let cookie: string | null = "unset";
    const fetch = withAuthCookie(
      () => Promise.resolve(""),
      (_input, init) => {
        cookie = new Headers(init?.headers).get("cookie");
        return Promise.resolve(new Response("{}"));
      },
    );

    await fetch(`${API}/api/app-auth/session`);

    expect(cookie).toBeNull();
  });
});
