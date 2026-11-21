import { describe, expect, it } from "vitest";

import type { DB } from "../infra/postgres/generated/db";
import { testAuthOptions } from "../test/auth-options";
import { scriptedDb } from "../test/scripted-db";
import {
  appRoleOf,
  createAppAuth,
  isBanned,
  readSessionOf,
  sessionOf,
  signedInOf,
  toAppSession,
} from "./instance";

const now = new Date("2026-11-19T12:00:00Z");

describe("appRoleOf", () => {
  it("is admin when any of the comma-separated roles is admin, and user otherwise", () => {
    expect(appRoleOf("admin")).toBe("admin");
    expect(appRoleOf("user, admin")).toBe("admin");
    expect(appRoleOf("user")).toBe("user");
    expect(appRoleOf("administrator")).toBe("user");
    expect(appRoleOf(null)).toBe("user");
    expect(appRoleOf(undefined)).toBe("user");
  });
});

describe("isBanned", () => {
  it("is true for a ban with no end or an end in the future", () => {
    expect(isBanned({ banned: true, banExpires: null }, now)).toBe(true);
    expect(isBanned({ banned: true, banExpires: new Date("2026-11-20T00:00:00Z") }, now)).toBe(
      true,
    );
  });

  it("is false when not banned or the ban has ended", () => {
    expect(isBanned({ banned: false, banExpires: null }, now)).toBe(false);
    expect(isBanned({ banned: null }, now)).toBe(false);
    expect(isBanned({ banned: true, banExpires: "2026-11-18T00:00:00Z" }, now)).toBe(false);
  });
});

describe("toAppSession", () => {
  const authUser = {
    id: "u1",
    email: "user@example.com",
    name: "User",
    image: undefined,
    emailVerified: true,
    role: "admin",
  };

  it("maps Better Auth's user and the session's expiry to AppSession", () => {
    expect(toAppSession(authUser, new Date("2026-11-26T12:00:00Z"))).toEqual({
      userId: "u1",
      email: "user@example.com",
      name: "User",
      image: null,
      role: "admin",
      emailVerified: true,
      expiresAt: "2026-11-26T12:00:00.000Z",
    });
  });

  it("gives the expiry as an ISO instant in UTC when it arrives as a string", () => {
    expect(toAppSession(authUser, "2026-11-26T14:00:00+02:00").expiresAt).toBe(
      "2026-11-26T12:00:00.000Z",
    );
  });
});

const user = {
  id: "u1",
  email: "user@example.com",
  name: "User",
  image: null,
  emailVerified: true,
  role: "user",
  banned: false,
};
const expiresAt = new Date("2026-11-26T12:00:00Z");

describe("sessionOf", () => {
  it("is the user's session, or none for no lookup result or a banned user", () => {
    expect(sessionOf({ user, session: { expiresAt } }, now)).toMatchObject({
      userId: "u1",
      role: "user",
      expiresAt: "2026-11-26T12:00:00.000Z",
    });
    expect(sessionOf(null, now)).toBeNull();
    expect(sessionOf({ user: { ...user, banned: true }, session: { expiresAt } }, now)).toBeNull();
  });
});

describe("signedInOf", () => {
  it("is the user's session with its row id, or none for no lookup result or a banned user", () => {
    const session = { id: "s1", expiresAt };

    expect(signedInOf({ user, session }, now)).toEqual({
      session: toAppSession(user, expiresAt),
      sessionId: "s1",
    });
    expect(signedInOf(null, now)).toBeNull();
    expect(signedInOf({ user: { ...user, banned: true }, session }, now)).toBeNull();
  });
});

describe("readSessionOf", () => {
  const renewal = ["s10n-base.session_token=renewed; Max-Age=604800"];

  it("passes on the cookies Better Auth set with the session", () => {
    const session = { expiresAt: "2026-11-26T12:00:00.000Z" };

    expect(readSessionOf({ user, session }, renewal, now)).toEqual({
      session: expect.objectContaining({
        userId: "u1",
        expiresAt: "2026-11-26T12:00:00.000Z",
      }) as unknown,
      setCookies: renewal,
    });
  });

  it("passes on the cookies of a lookup that found nothing, such as clearing a stale one", () => {
    expect(readSessionOf(null, renewal, now)).toEqual({ session: null, setCookies: renewal });
  });

  it("drops a banned user's renewal", () => {
    expect(
      readSessionOf({ user: { ...user, banned: true }, session: { expiresAt } }, renewal, now),
    ).toEqual({
      session: null,
      setCookies: [],
    });
  });
});

describe("createAppAuth", () => {
  it("answers no session to a request without a cookie, without reading the database", async () => {
    const { db, queries } = scriptedDb<DB>(() => []);
    const auth = createAppAuth(testAuthOptions({}, db));

    expect(await auth.getSession(new Headers())).toBeNull();
    expect(await auth.readSession(new Headers())).toEqual({ session: null, setCookies: [] });
    expect(queries).toEqual([]);
  });

  it("trusts APP_URL's origin and no other", async () => {
    const auth = createAppAuth(testAuthOptions());

    expect(await auth.isTrustedOrigin("http://localhost:5173")).toBe(true);
    expect(await auth.isTrustedOrigin("https://evil.example.com")).toBe(false);
  });

  it("renames a user through Better Auth's adapter, which updates the user row", async () => {
    const { db, queries } = scriptedDb<DB>(() => [
      {
        id: "u1",
        name: "Sam",
        email: "user@example.com",
        email_verified: true,
        image: null,
        created_at: new Date("2026-11-19T10:00:00Z"),
        updated_at: new Date("2026-11-19T12:00:00Z"),
        role: "user",
      },
    ]);
    const auth = createAppAuth(testAuthOptions({}, db), () => now);

    expect(await auth.updateUserName("u1", "Sam")).toMatchObject({ id: "u1", name: "Sam" });
    expect(queries[0]?.sql).toMatch(/^update "ba_user" set "name" = \$1/);
  });

  it("serves Better Auth's own routes through its handler, counting the request", async () => {
    const { db, queries } = scriptedDb<DB>(() => []);
    const auth = createAppAuth(testAuthOptions({}, db));

    const response = await auth.handler(new Request("http://localhost:5173/api/auth/ok"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // The rate limiter keeps its counts in the database, in every environment.
    expect(queries.some((query) => query.sql.includes('"ba_rate_limit"'))).toBe(true);
  });
});
