import { describe, expect, it } from "vitest";

import { profileFromUser } from "./profile";

describe("profileFromUser", () => {
  it("maps a user row to the Profile contract", () => {
    expect(
      profileFromUser({
        id: "u1",
        name: "Sam",
        email: "sam@example.com",
        image: null,
        role: "admin,user",
        emailVerified: true,
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
      }),
    ).toEqual({
      userId: "u1",
      name: "Sam",
      email: "sam@example.com",
      image: null,
      role: "admin",
      emailVerified: true,
      createdAt: "2026-11-19T10:00:00.000Z",
    });
  });

  it("treats a missing role as user and accepts a string time", () => {
    expect(
      profileFromUser({
        id: "u1",
        name: "Sam",
        email: "sam@example.com",
        image: undefined,
        role: null,
        emailVerified: false,
        createdAt: "2026-11-19T10:00:00Z",
      }),
    ).toMatchObject({ role: "user", image: null, createdAt: "2026-11-19T10:00:00.000Z" });
  });
});
