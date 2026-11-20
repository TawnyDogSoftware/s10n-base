import { describe, expect, it } from "vitest";

import { readApiBaseUrl } from "./config";

const PAGE = "http://localhost:5173";

describe("readApiBaseUrl", () => {
  it("defaults to the page's own origin", () => {
    expect(readApiBaseUrl({}, PAGE)).toBe(PAGE);
    expect(readApiBaseUrl({ VITE_API_BASE_URL: "" }, PAGE)).toBe(PAGE);
    expect(readApiBaseUrl({ VITE_API_BASE_URL: "  " }, PAGE)).toBe(PAGE);
  });

  it("accepts a bare origin, with or without a trailing slash", () => {
    expect(readApiBaseUrl({ VITE_API_BASE_URL: "https://api.example.com" }, PAGE)).toBe(
      "https://api.example.com",
    );
    expect(readApiBaseUrl({ VITE_API_BASE_URL: "http://127.0.0.1:4210/" }, PAGE)).toBe(
      "http://127.0.0.1:4210",
    );
  });

  it.each([
    "/api",
    "api.example.com",
    "https://api.example.com/v1",
    "https://api.example.com?x=1",
    "https://api.example.com#x",
    "https://user:pass@api.example.com",
    "ftp://api.example.com",
  ])("refuses %j, naming the variable", (value) => {
    expect(() => readApiBaseUrl({ VITE_API_BASE_URL: value }, PAGE)).toThrow(/VITE_API_BASE_URL/);
  });
});
