import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ADMIN_USERS_PAGE_MAX,
  AdminUserList,
  PROFILE_NAME_MAX,
  Profile,
  ProfileName,
  adminListUsers,
  profileGet,
  profileUpdate,
  rpcContracts,
} from "./index";

const profile = {
  userId: "6f1c2b9e-0000-4000-8000-000000000001",
  name: "Sam Example",
  email: "sam@example.com",
  image: null,
  role: "user",
  emailVerified: true,
  createdAt: "2026-11-19T10:00:00.000Z",
};

describe("rpcContracts", () => {
  it("lists the profile and admin methods with their auth levels", () => {
    expect(rpcContracts.map((contract) => [contract.method, contract.auth])).toEqual([
      ["profile.get", "session"],
      ["profile.update", "session"],
      ["admin.listUsers", { role: "admin" }],
    ]);
  });
});

describe("profile.get", () => {
  it("takes an empty payload and returns the caller's profile", () => {
    expect(Schema.decodeUnknownSync(profileGet.payload)({})).toEqual({});
    expect(Schema.decodeUnknownSync(profileGet.success)(profile)).toEqual(profile);
  });

  it("has exactly the profile fields", () => {
    expect(
      Object.keys(Profile.fields).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["createdAt", "email", "emailVerified", "image", "name", "role", "userId"]);
  });
});

describe("profile.update and ProfileName", () => {
  const decodeName = Schema.decodeUnknownExit(ProfileName);

  it("trims the name", () => {
    expect(Schema.decodeUnknownSync(profileUpdate.payload)({ name: "  Sam  " })).toEqual({
      name: "Sam",
    });
  });

  it("accepts 1 to 100 characters after trimming, and nothing else", () => {
    expect(PROFILE_NAME_MAX).toBe(100);
    expect(decodeName("a")._tag).toBe("Success");
    expect(decodeName("a".repeat(100))._tag).toBe("Success");
    expect(decodeName(` ${"a".repeat(100)} `)._tag).toBe("Success");
    expect(decodeName("a".repeat(101))._tag).toBe("Failure");
    expect(decodeName("")._tag).toBe("Failure");
    expect(decodeName("   ")._tag).toBe("Failure");
    expect(decodeName(42)._tag).toBe("Failure");
  });

  it("refuses a NUL character, which Postgres cannot store in text", () => {
    expect(decodeName("Sam\u0000")._tag).toBe("Failure");
  });

  it("returns the updated profile", () => {
    expect(Schema.decodeUnknownSync(profileUpdate.success)(profile)).toEqual(profile);
  });
});

describe("admin.listUsers", () => {
  const decodePayload = Schema.decodeUnknownExit(adminListUsers.payload);

  it("takes a limit from 1 to 100 and an optional cursor", () => {
    expect(ADMIN_USERS_PAGE_MAX).toBe(100);
    expect(Schema.decodeUnknownSync(adminListUsers.payload)({ limit: 1 })).toEqual({ limit: 1 });
    expect(Schema.decodeUnknownSync(adminListUsers.payload)({ limit: 100, cursor: "abc" })).toEqual(
      { limit: 100, cursor: "abc" },
    );
    expect(Schema.decodeUnknownSync(adminListUsers.payload)({ limit: 5, cursor: null })).toEqual({
      limit: 5,
      cursor: null,
    });
  });

  it.each([0, 101, 1.5, -1, "10", null])("refuses the limit %j", (limit) => {
    expect(decodePayload({ limit })._tag).toBe("Failure");
  });

  it("refuses an empty or oversized cursor", () => {
    expect(decodePayload({ limit: 5, cursor: "" })._tag).toBe("Failure");
    expect(decodePayload({ limit: 5, cursor: "a".repeat(513) })._tag).toBe("Failure");
  });

  it("returns users and the next cursor", () => {
    const page = {
      users: [
        {
          id: profile.userId,
          name: "Sam Example",
          email: "sam@example.com",
          role: "admin",
          emailVerified: false,
          banned: false,
          createdAt: "2026-11-19T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    expect(Schema.decodeUnknownSync(AdminUserList)(page)).toEqual(page);
    expect(Schema.decodeUnknownSync(adminListUsers.success)(page)).toEqual(page);
  });
});
