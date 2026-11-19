import { describe, expect, it } from "vitest";

import { decodeUserCursor, encodeUserCursor } from "./user-cursor";

const position = {
  createdAt: "2026-11-19T10:00:00.123456Z",
  id: "6f1c2b9e-0000-4000-8000-000000000001",
};

describe("user cursor", () => {
  it("round-trips a position, keeping microseconds", () => {
    const cursor = encodeUserCursor(position);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeUserCursor(cursor)).toEqual(position);
  });

  it.each([
    ["not base64url", "!!!"],
    ["not JSON", Buffer.from("nope").toString("base64url")],
    ["an array", Buffer.from("[]").toString("base64url")],
    ["null", Buffer.from("null").toString("base64url")],
    ["a missing id", Buffer.from(JSON.stringify({ at: position.createdAt })).toString("base64url")],
    [
      "a bad id",
      Buffer.from(JSON.stringify({ at: position.createdAt, id: "x" })).toString("base64url"),
    ],
    [
      "a time without microseconds",
      Buffer.from(JSON.stringify({ at: "2026-11-19T10:00:00Z", id: position.id })).toString(
        "base64url",
      ),
    ],
    [
      "an impossible date",
      Buffer.from(JSON.stringify({ at: "2026-13-45T10:00:00.000000Z", id: position.id })).toString(
        "base64url",
      ),
    ],
    [
      "extra keys",
      Buffer.from(JSON.stringify({ at: position.createdAt, id: position.id, x: 1 })).toString(
        "base64url",
      ),
    ],
  ])("refuses %s", (_label, cursor) => {
    expect(decodeUserCursor(cursor)).toBeNull();
  });
});
