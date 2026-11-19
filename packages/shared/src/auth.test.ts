import { describe, expect, it } from "vitest";

import { AUTH_COOKIE_PREFIX } from "./auth";

describe("AUTH_COOKIE_PREFIX", () => {
  it("is a valid cookie-name prefix", () => {
    // RFC 6265 token characters, without the "." Better Auth adds after it.
    expect(AUTH_COOKIE_PREFIX).toMatch(/^[A-Za-z0-9!#$%&'*+^_`|~-]+$/);
  });
});
