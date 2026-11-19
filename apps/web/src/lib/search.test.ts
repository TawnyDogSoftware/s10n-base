import { describe, expect, it } from "vitest";

import { parseSearch, stringifySearch } from "./search";

describe("parseSearch", () => {
  it("keeps every value a string, where TanStack Router's default would turn some into numbers", () => {
    expect(parseSearch("?token=123456&a=1e5&b=true&c=null&d=007")).toEqual({
      token: "123456",
      a: "1e5",
      b: "true",
      c: "null",
      d: "007",
    });
  });

  it("decodes percent-escapes and keeps a literal plus sign, which our links never use for a space", () => {
    expect(parseSearch("?token=a%2Bb%3D%3D&raw=a+b=&space=a%20b")).toEqual({
      token: "a+b==",
      raw: "a+b=",
      space: "a b",
    });
  });

  it("takes the first of repeated keys, and accepts a string with or without the question mark", () => {
    expect(parseSearch("token=first&token=second")).toEqual({ token: "first" });
    expect(parseSearch("")).toEqual({});
    expect(parseSearch("?")).toEqual({});
    expect(parseSearch("?flag")).toEqual({ flag: "" });
  });

  it("ignores a malformed escape rather than throwing", () => {
    expect(parseSearch("?bad=%E0%A4%A&ok=1")).toEqual({ ok: "1" });
  });

  it("has no prototype keys", () => {
    const parsed = parseSearch("?__proto__=x&constructor=y");

    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(parsed.__proto__).toBe("x");
    expect(parsed.constructor).toBe("y");
  });
});

describe("stringifySearch", () => {
  it("writes strings percent-encoded, and skips undefined", () => {
    expect(stringifySearch({ token: "a+b=", redirect: "/x?y=1", gone: undefined })).toBe(
      "?token=a%2Bb%3D&redirect=%2Fx%3Fy%3D1",
    );
    expect(stringifySearch({})).toBe("");
  });

  it("writes numbers and booleans as their text", () => {
    expect(stringifySearch({ page: 2, open: true })).toBe("?page=2&open=true");
  });

  it("refuses anything else, rather than writing [object Object]", () => {
    expect(() => stringifySearch({ filter: { a: 1 } })).toThrow(/filter/);
  });

  it.each([
    "123456",
    "1e5",
    "true",
    "null",
    "12345678901234567890",
    "a+b=c==",
    "/path?x=1&y=2",
    "  spaced  ",
    "ünï",
  ])("round-trips %j unchanged", (token) => {
    expect(parseSearch(stringifySearch({ token }))).toEqual({ token });
  });
});
