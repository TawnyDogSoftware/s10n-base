import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { decodeUnknown, encode, safeJsonParse } from "./json";

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });

describe("decodeUnknown", () => {
  it("returns a value that matches the schema", () => {
    expect(decodeUnknown(Point, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });

  it("throws on a value that does not match", () => {
    expect(() => decodeUnknown(Point, { x: "1", y: 2 })).toThrow();
  });
});

describe("encode", () => {
  it("encodes a value with the schema", () => {
    expect(encode(Point, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

describe("safeJsonParse", () => {
  it("parses JSON text", () => {
    expect(safeJsonParse('{"a":[1,true,null]}')).toEqual({ a: [1, true, null] });
  });

  it("throws on text that is not JSON", () => {
    expect(() => safeJsonParse("{")).toThrow(SyntaxError);
  });
});
