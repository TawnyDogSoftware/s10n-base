import { describe, expect, it } from "vitest";

import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it.each(["/", "/profile", "/admin/users?x=1#top", "/a/b/../c", "/path%2F"])(
    "accepts the same-origin path %j",
    (target) => {
      expect(safeRedirect(target)).toBe(target);
    },
  );

  it.each([
    "https://evil.example.com/",
    "http://app.example.com/profile",
    "//evil.example.com/",
    "///evil.example.com/",
    "/\\evil.example.com/",
    "\\\\evil.example.com/",
    "/\t/evil.example.com/",
    "/\n/evil.example.com",
    "javascript:alert(1)",
    "profile",
    "",
    " /profile",
  ])("refuses %j", (target) => {
    expect(safeRedirect(target)).toBeUndefined();
  });

  it.each([undefined, null, 42, ["/profile"], {}])("refuses a non-string %j", (target) => {
    expect(safeRedirect(target)).toBeUndefined();
  });
});
