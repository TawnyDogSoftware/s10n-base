import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ERROR_CODES } from "@s10n-base/contracts";

import { setUserRole } from "../set-role-cli";
import { startAuthServer, TestClient, verifyPath, type AuthServer } from "../test/auth-server";

const PASSWORD = "correct horse battery staple";
let app: AuthServer;
let nextIp = 1;

function client() {
  return new TestClient(app.base, `198.51.100.${String(nextIp++)}`);
}

function address(name: string) {
  return `${name}-${String(nextIp)}@example.com`;
}

async function signedInUser(email: string, name = "Test User") {
  const browser = client();
  expect(
    (await browser.post("/api/auth/sign-up/email", { name, email, password: PASSWORD })).status,
  ).toBe(200);
  const [message] = (await app.emailsTo(email)).slice(-1);
  expect((await browser.get(verifyPath(message))).status).toBe(200);
  expect(
    (await browser.post("/api/auth/sign-in/email", { email, password: PASSWORD })).status,
  ).toBe(200);
  return browser;
}

async function call(browser: TestClient, method: string, payload: unknown = {}) {
  const response = await browser.post("/rpc", { method, payload });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  app = await startAuthServer();
});

afterAll(async () => {
  await app.stop();
});

describe("profile.get", () => {
  it("returns the caller's profile", async () => {
    const email = address("profile");
    const browser = await signedInUser(email, "Robin Example");
    const session = (await browser.session()) as { userId: string };

    const result = await call(browser, "profile.get");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      data: {
        userId: session.userId,
        name: "Robin Example",
        email,
        image: null,
        role: "user",
        emailVerified: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    });
  });

  it("refuses an anonymous caller with 401", async () => {
    const result = await call(client(), "profile.get");

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: ERROR_CODES.unauthenticated } });
  });
});

describe("profile.update", () => {
  it("trims and saves the name, and the session route shows it at once", async () => {
    const browser = await signedInUser(address("rename"));

    const result = await call(browser, "profile.update", { name: "  New Name  " });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, data: { name: "New Name" } });
    expect(await browser.session()).toMatchObject({ name: "New Name" });
    expect((await call(browser, "profile.get")).body).toMatchObject({ data: { name: "New Name" } });
  });

  it.each([{ name: "" }, { name: "   " }, { name: "x".repeat(101) }, {}])(
    "refuses the payload %j with 400",
    async (payload) => {
      const browser = await signedInUser(address("bad-name"));

      const result = await call(browser, "profile.update", payload);

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: ERROR_CODES.invalidPayload } });
      expect(await browser.session()).toMatchObject({ name: "Test User" });
    },
  );

  it("refuses an anonymous caller with 401", async () => {
    expect((await call(client(), "profile.update", { name: "Nobody" })).status).toBe(401);
  });
});

describe("admin.listUsers", () => {
  let admin: TestClient;

  beforeAll(async () => {
    const email = address("admin");
    admin = await signedInUser(email);
    await setUserRole(app.schema.db, email, "admin");
  });

  it("refuses a signed-in user with 403 and an anonymous caller with 401", async () => {
    const user = await signedInUser(address("plain"));

    expect((await call(user, "admin.listUsers", { limit: 10 })).status).toBe(403);
    expect((await call(client(), "admin.listUsers", { limit: 10 })).status).toBe(401);
  });

  it("refuses a limit outside 1 to 100 with 400", async () => {
    for (const limit of [0, 101]) {
      const result = await call(admin, "admin.listUsers", { limit });
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: ERROR_CODES.invalidPayload } });
    }
  });

  it.each(["not-a-cursor", Buffer.from('{"at":"x","id":"y"}').toString("base64url")])(
    "refuses the cursor %s with 400",
    async (cursor) => {
      const result = await call(admin, "admin.listUsers", { limit: 5, cursor });

      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: ERROR_CODES.invalidCursor } });
    },
  );

  it("pages through every user newest first, with no user repeated or skipped when times are equal", async () => {
    // Twelve users created in one statement share one created_at, so only the id orders them.
    await sql`
      insert into ba_user (name, email, email_verified, role, created_at, updated_at)
      select 'Bulk ' || n, 'bulk-' || n || '@example.com', n % 2 = 0, 'user',
             timestamptz '2020-01-01 00:00:00.123456+00', now()
      from generate_series(1, 12) as n
    `.execute(app.schema.db);
    const expected = await app.schema.db
      .selectFrom("ba_user")
      .select(["id"])
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const result = await call(admin, "admin.listUsers", { limit: 5, cursor });
      expect(result.status).toBe(200);
      const data = (
        result.body as { data: { users: Array<{ id: string }>; nextCursor: string | null } }
      ).data;
      expect(data.users.length).toBeLessThanOrEqual(5);
      seen.push(...data.users.map((user) => user.id));
      cursor = data.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 50);

    expect(seen).toEqual(expected.map((row) => row.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBe(Math.ceil(expected.length / 5));
  });

  it("returns each user's fields", async () => {
    const result = await call(admin, "admin.listUsers", { limit: 100 });
    const users = (result.body as { data: { users: Array<Record<string, unknown>> } }).data.users;
    const bulk = users.find((user) => user.email === "bulk-2@example.com");

    expect(bulk).toEqual({
      id: expect.any(String),
      name: "Bulk 2",
      email: "bulk-2@example.com",
      role: "user",
      emailVerified: true,
      banned: false,
      createdAt: "2020-01-01T00:00:00.123Z",
    });
  });
});
