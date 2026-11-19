import { describe, expect, it } from "vitest";

import { parseBareOrigin } from "./origin";

describe("parseBareOrigin", () => {
  it.each([
    ["https://api.example.com", "https://api.example.com"],
    ["https://api.example.com/", "https://api.example.com"],
    ["http://127.0.0.1:4210", "http://127.0.0.1:4210"],
    ["HTTPS://API.Example.com:443", "https://api.example.com"],
    ["http://[::1]:8005", "http://[::1]:8005"],
  ])("accepts %s as %s", (value, origin) => {
    expect(parseBareOrigin(value)?.origin).toBe(origin);
  });

  it.each([
    ["not a url", "no scheme"],
    ["", "empty"],
    ["ftp://example.com", "another scheme"],
    ["https://example.com/api", "a path"],
    ["https://example.com/?x=1", "a query"],
    ["https://example.com/?", "an empty query"],
    ["https://example.com/#top", "a fragment"],
    ["https://example.com/#", "an empty fragment"],
    ["https://user:secret@example.com", "credentials"],
    ["https://user@example.com", "a user name"],
  ])("refuses %j (%s)", (value) => {
    expect(parseBareOrigin(value)).toBeNull();
  });
});
