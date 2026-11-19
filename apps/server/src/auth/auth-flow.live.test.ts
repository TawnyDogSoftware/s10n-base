import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineRpc, ERROR_CODES } from "@s10n-base/contracts";

import { defineHandler } from "../rpc/dispatcher";
import { setUserRole } from "../set-role-cli";
import {
  linkIn,
  startAuthServer,
  TestClient,
  tokenIn,
  verifyPath,
  type AuthServer,
} from "../test/auth-server";

const Empty = Schema.Struct({});
const WhoAmI = Schema.Struct({ userId: Schema.String, role: Schema.String });
const whoAmI = defineRpc({
  method: "fixture.whoami",
  auth: "session",
  payload: Empty,
  success: WhoAmI,
});
const adminOnly = defineRpc({
  method: "fixture.admin",
  auth: { role: "admin" },
  payload: Empty,
  success: Empty,
});
const handlers = [
  defineHandler(whoAmI, async (_payload, context) => {
    const actor = await context.getActor();
    if (actor.kind !== "user") throw new Error("unreachable: the dispatcher checked the session");
    return { userId: actor.userId, role: actor.role };
  }),
  defineHandler(adminOnly, () => Promise.resolve({})),
];

const PASSWORD = "correct horse battery staple";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: AuthServer;
let nextIp = 1;

/** A client with an address no other test uses. */
function client(origin?: string | null) {
  const ip = `198.51.100.${String(nextIp++)}`;
  return new TestClient(app.base, ip, origin === null ? undefined : (origin ?? app.base));
}

function email(name: string) {
  return `${name}-${String(nextIp)}@example.com`;
}

async function signUp(browser: TestClient, address: string, password = PASSWORD) {
  return browser.post("/api/auth/sign-up/email", { name: "Test User", email: address, password });
}

async function verify(browser: TestClient, address: string) {
  const [message] = (await app.emailsTo(address)).slice(-1);
  return browser.get(verifyPath(message));
}

/** Signs up, verifies and signs in; returns the signed-in client. */
async function signedInUser(address: string) {
  const browser = client();
  expect((await signUp(browser, address)).status).toBe(200);
  await verify(browser, address);
  expect(
    (await browser.post("/api/auth/sign-in/email", { email: address, password: PASSWORD })).status,
  ).toBe(200);
  return browser;
}

function rpc(browser: TestClient, method: string) {
  return browser.post("/rpc", { method, payload: {} });
}

beforeAll(async () => {
  app = await startAuthServer({ handlers });
});

afterAll(async () => {
  await app.stop();
});

describe("sign-up, verification, sign-in and sign-out", () => {
  it("works end to end over HTTP, with the email read from the capture server", async () => {
    const browser = client();
    const address = email("journey");

    const signedUp = await signUp(browser, address);
    expect(signedUp.status).toBe(200);
    expect(await browser.session()).toBeNull();

    const emails = await app.emailsTo(address);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe("Confirm your email address");
    expect(emails[0]?.from).toBe("no-reply@example.com");
    // The link opens the web app's page, which sends the token to Better Auth.
    const link = new URL(linkIn(emails[0]));
    expect(link.origin).toBe(app.base);
    expect(link.pathname).toBe("/verify-email");
    expect([...link.searchParams.keys()]).toEqual(["token"]);

    const verified = await browser.get(verifyPath(emails[0]));
    expect(verified.status).toBe(200);

    const signedIn = await browser.post("/api/auth/sign-in/email", {
      email: address,
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    const { userId, ...session } = (await browser.session()) as Record<string, unknown>;
    expect(userId).toMatch(UUID);
    expect(session).toEqual({
      email: address,
      name: "Test User",
      image: null,
      role: "user",
      emailVerified: true,
    });

    const cookieBeforeSignOut = browser.cookieHeader();
    const signedOut = await browser.post("/api/auth/sign-out");
    expect(signedOut.status).toBe(200);
    expect(await browser.session()).toBeNull();

    // The old cookie no longer works either: the session row is gone.
    const replay = client();
    const response = await replay.get("/api/app-auth/session", { cookie: cookieBeforeSignOut });
    expect(await response.json()).toEqual({ ok: true, data: { session: null } });
  });

  it("refuses sign-in before verification and sends another verification email", async () => {
    const browser = client();
    const address = email("unverified");
    await signUp(browser, address);

    const attempt = await browser.post("/api/auth/sign-in/email", {
      email: address,
      password: PASSWORD,
    });

    expect(attempt.status).toBe(403);
    expect(await browser.session()).toBeNull();
    expect(await app.emailsTo(address)).toHaveLength(2);
  });

  it("keeps several Set-Cookie headers apart through the bridge", async () => {
    const browser = await signedInUser(email("cookies"));

    const signedOut = await browser.post("/api/auth/sign-out");

    const cookies = signedOut.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(1);
    for (const cookie of cookies) expect(cookie).toMatch(/^s10n-base\.[a-z_]+=/);
  });
});

describe("session renewal", () => {
  it("renews an active session's cookie through the app's session route", async () => {
    const browser = await signedInUser(email("renewal"));
    const session = (await browser.session()) as { userId: string };
    // Better Auth renews a session once it is a day old (updateAge): age this one by two days.
    const aged = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await app.schema.db
      .updateTable("ba_session")
      .set({ expires_at: aged })
      .where("user_id", "=", session.userId)
      .execute();

    const response = await browser.get("/api/app-auth/session");

    expect(((await response.json()) as { data: { session: unknown } }).data.session).not.toBeNull();
    const renewed = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("s10n-base.session_token="));
    expect(renewed).toMatch(/Max-Age=604800/i);
    const row = await app.schema.db
      .selectFrom("ba_session")
      .select("expires_at")
      .where("user_id", "=", session.userId)
      .executeTakeFirstOrThrow();
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(aged.getTime());
  });

  it("sends no cookie when the session is fresh", async () => {
    const browser = await signedInUser(email("fresh"));

    const response = await browser.get("/api/app-auth/session");

    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("cross-site requests to /api/auth", () => {
  it("refuses a sign-in from a foreign Origin, and allows one with no Origin, as a mobile app sends", async () => {
    const address = email("cross-site");
    await signedInUser(address);

    const foreign = client("https://evil.example.com");
    const fromForeign = await foreign.post("/api/auth/sign-in/email", {
      email: address,
      password: PASSWORD,
    });
    const noOrigin = client(null);
    const fromApp = await noOrigin.post("/api/auth/sign-in/email", {
      email: address,
      password: PASSWORD,
    });

    expect(fromForeign.status).toBe(403);
    expect(fromApp.status).toBe(200);
  });

  it("refuses a request that carries a session cookie and a foreign Origin, and the session survives", async () => {
    const browser = await signedInUser(email("csrf"));
    const foreign = client("https://evil.example.com");
    foreign.copyCookiesFrom(browser);

    const attempt = await foreign.post("/api/auth/sign-out");

    expect(attempt.status).toBe(403);
    expect(await browser.session()).not.toBeNull();
  });
});

describe("password reset", () => {
  it("emails a link, sets the new password, revokes old sessions and retires the old password", async () => {
    const address = email("reset");
    const first = await signedInUser(address);
    const second = client();
    expect(
      (await second.post("/api/auth/sign-in/email", { email: address, password: PASSWORD })).status,
    ).toBe(200);
    expect(await first.session()).not.toBeNull();
    expect(await second.session()).not.toBeNull();

    const requester = client();
    const requested = await requester.post("/api/auth/request-password-reset", {
      email: address,
    });
    expect(requested.status).toBe(200);
    const [resetEmail] = (await app.emailsTo(address)).slice(-1);
    expect(resetEmail?.subject).toBe("Reset your password");
    // The link opens the web app's page, which sends the token with the new password.
    const link = new URL(linkIn(resetEmail));
    expect(link.origin).toBe(app.base);
    expect(link.pathname).toBe("/reset-password");
    const token = tokenIn(resetEmail);

    const reset = await requester.post("/api/auth/reset-password", {
      token,
      newPassword: "a brand new passphrase",
    });
    expect(reset.status).toBe(200);

    expect(await first.session()).toBeNull();
    expect(await second.session()).toBeNull();
    const oldPassword = client();
    expect(
      (await oldPassword.post("/api/auth/sign-in/email", { email: address, password: PASSWORD }))
        .status,
    ).toBe(401);
    const newPassword = client();
    expect(
      (
        await newPassword.post("/api/auth/sign-in/email", {
          email: address,
          password: "a brand new passphrase",
        })
      ).status,
    ).toBe(200);
  });
});

async function rateLimitRows() {
  return app.schema.db.selectFrom("ba_rate_limit").select(["key", "count"]).execute();
}

describe("the route guard and rate limits", () => {
  it("answers 404 to an unknown /api/auth path and adds no rate-limit row", async () => {
    const browser = client();
    const before = await rateLimitRows();

    for (const path of ["/api/auth/not-a-route", "/api/auth/sign-in/social", "/api/auth/ok"]) {
      const response = await browser.post(path, {});
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: ERROR_CODES.notFound, message: "Not found." },
      });
    }

    // Reset emails link to the web app's page, so Better Auth's own reset link is not exposed.
    expect((await browser.get("/api/auth/reset-password/some-token")).status).toBe(404);

    expect(await rateLimitRows()).toEqual(before);
  });

  it("limits repeated bad sign-ins from one address, keeping the counts in the database", async () => {
    const browser = client();
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await browser.post("/api/auth/sign-in/email", {
        email: email("nobody"),
        password: "wrong password here",
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    const rows = await rateLimitRows();
    expect(rows.some((row) => row.key.startsWith(`${browser.ip}|`) && row.count >= 3)).toBe(true);
  });
});

describe("admin endpoints", () => {
  it("keeps /admin/remove-user off, refuses admin endpoints to a user, and allows them after auth:set-role", async () => {
    const address = email("admin");
    const browser = await signedInUser(address);

    expect((await browser.post("/api/auth/admin/remove-user", { userId: "x" })).status).toBe(404);
    const asUser = await browser.get("/api/auth/admin/list-users");
    expect(asUser.status).toBe(403);

    await setUserRole(app.schema.db, address, "admin");

    const asAdmin = await browser.get("/api/auth/admin/list-users");
    expect(asAdmin.status).toBe(200);
    const listed = (await asAdmin.json()) as { users: Array<{ email: string }> };
    expect(listed.users.map((user) => user.email)).toContain(address);
    expect((await browser.session()) as { role: string }).toMatchObject({ role: "admin" });
  });
});

describe("RPC with the session", () => {
  it("lets a signed-in user call a session method, refuses an admin method, and refuses anonymous callers", async () => {
    const address = email("rpc");
    const browser = await signedInUser(address);
    const session = (await browser.session()) as { userId: string };

    const mine = await rpc(browser, "fixture.whoami");
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ ok: true, data: { userId: session.userId, role: "user" } });
    expect((await rpc(browser, "fixture.admin")).status).toBe(403);

    const anonymous = client();
    const refused = await rpc(anonymous, "fixture.whoami");
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.unauthenticated,
    );
  });

  it("refuses a foreign Origin with 403, even with a valid session cookie", async () => {
    const browser = await signedInUser(email("foreign"));
    const foreign = client("https://evil.example.com");
    foreign.copyCookiesFrom(browser);

    expect((await rpc(foreign, "fixture.whoami")).status).toBe(403);
  });

  it("accepts a request with no Origin and a session cookie, as a mobile app sends", async () => {
    const browser = await signedInUser(email("mobile"));
    const mobile = client(null);
    mobile.copyCookiesFrom(browser);

    expect((await rpc(mobile, "fixture.whoami")).status).toBe(200);
  });
});

describe("passkeys", () => {
  it("returns registration options to a signed-in user and refuses them when signed out", async () => {
    const browser = await signedInUser(email("passkey"));

    const options = await browser.get("/api/auth/passkey/generate-register-options");
    expect(options.status).toBe(200);
    const body = (await options.json()) as {
      challenge?: string;
      rp?: { id: string; name: string };
    };
    expect(typeof body.challenge).toBe("string");
    expect(body.rp).toEqual({ id: "127.0.0.1", name: "S10N Base" });

    expect((await client().get("/api/auth/passkey/generate-register-options")).status).toBe(401);
  });
});
