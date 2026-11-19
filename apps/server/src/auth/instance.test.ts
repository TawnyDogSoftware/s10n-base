import { describe, expect, it } from "vitest";

import { appRoleOf, isBanned, toAppSession } from "./instance";

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
  it("maps Better Auth's user to AppSession", () => {
    expect(
      toAppSession({
        id: "u1",
        email: "user@example.com",
        name: "User",
        image: undefined,
        emailVerified: true,
        role: "admin",
      }),
    ).toEqual({
      userId: "u1",
      email: "user@example.com",
      name: "User",
      image: null,
      role: "admin",
      emailVerified: true,
    });
  });
});
