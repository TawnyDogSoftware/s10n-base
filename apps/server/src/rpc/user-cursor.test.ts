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

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("decodeUserCursor, given the right shape with wrong values", () => {
  const id = "6f1c2b9e-0000-4000-8000-000000000001";

  it.each([
    ["a time that is not a real date", { at: "2026-02-30T10:00:00.000000Z", id }],
    ["an id that is not a uuid", { at: "2026-11-19T10:00:00.000000Z", id: "user-1" }],
    ["values that are not text", { at: 1, id: 2 }],
    ["year zero, which Postgres does not have", { at: "0000-01-01T00:00:00.000000Z", id }],
  ])("refuses %s", (_case, value) => {
    expect(decodeUserCursor(encode(value))).toBeNull();
  });
});

describe("decodeUserCursor, at the edges of the calendar", () => {
  it("accepts the first and last instants of years 1 to 9999", () => {
    const id = "6f1c2b9e-0000-4000-8000-000000000001";
    for (const at of ["0001-01-01T00:00:00.000000Z", "9999-12-31T23:59:59.999999Z"]) {
      expect(decodeUserCursor(encode({ at, id }))).toEqual({ createdAt: at, id });
    }
  });
});
