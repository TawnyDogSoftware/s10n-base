import { describe, expect, it } from "vitest";

import { testAuthOptions } from "../test/auth-options";
import { createAppAuth } from "./instance";
import { authRouteInventory, createAuthRouteGuard, type InventoryEndpoint } from "./route-guard";

const BASE = "https://app.example.com";

function url(path: string) {
  return new URL(`${BASE}/api/auth${path}`);
}

describe("authRouteInventory", () => {
  it("lists each method of each endpoint, without server-only endpoints, pathless ones or disabled paths", () => {
    const endpoints: Record<string, InventoryEndpoint> = {
      session: { path: "/get-session", options: { method: ["GET", "POST"] } },
      signIn: { path: "/sign-in/email", options: { method: "POST" } },
      hidden: { path: "/hidden", options: { method: "POST", metadata: { SERVER_ONLY: true } } },
      pathless: { options: { method: "POST" } },
      methodless: { path: "/no-method", options: {} },
      removed: { path: "/admin/remove-user", options: { method: "POST" } },
    };

    expect(authRouteInventory(endpoints, ["/admin/remove-user"])).toEqual([
      { method: "GET", path: "/get-session" },
      { method: "POST", path: "/get-session" },
      { method: "POST", path: "/sign-in/email" },
    ]);
  });
});

describe("createAuthRouteGuard", () => {
  const guard = createAuthRouteGuard(
    [
      { method: "GET", path: "/get-session" },
      { method: "GET", path: "/reset-password/:token" },
      { method: "POST", path: "/reset-password" },
    ],
    { basePath: "/api/auth", skipTrailingSlashes: false },
  );

  it.each([
    ["GET", "/get-session", true],
    ["GET", "/get-session?disableCookieCache=true", true],
    ["POST", "/get-session", false],
    ["DELETE", "/get-session", false],
    ["GET", "/get-session/", false],
    ["GET", "//get-session", false],
    ["GET", "/reset-password/some-token", true],
    ["GET", "/reset-password/some-token/extra", false],
    ["POST", "/reset-password", true],
    ["GET", "/reset-password", false],
    ["GET", "/not-an-endpoint", false],
    ["GET", "", false],
    ["TRACE", "/get-session", false],
  ] as const)("%s %s → %s", async (method, path, expected) => {
    expect(await guard(method, url(path))).toBe(expected);
  });

  it("refuses paths outside the base path", async () => {
    expect(await guard("GET", new URL(`${BASE}/get-session`))).toBe(false);
    expect(await guard("GET", new URL(`${BASE}/api/authget-session`))).toBe(false);
  });
});

describe("the server's guard", () => {
  const auth = createAppAuth(testAuthOptions());

  it("admits exposed routes and refuses the rest, including the disabled remove-user endpoint", async () => {
    expect(await auth.guard("POST", url("/sign-in/email"))).toBe(true);
    expect(await auth.guard("GET", url("/passkey/generate-register-options"))).toBe(true);
    expect(await auth.guard("POST", url("/admin/remove-user"))).toBe(false);
    expect(await auth.guard("POST", url("/admin/impersonate-user"))).toBe(false);
    expect(await auth.guard("POST", url("/sign-in/social"))).toBe(false);
    expect(await auth.guard("GET", url("/ok"))).toBe(false);
  });
});
