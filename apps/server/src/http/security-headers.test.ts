import { describe, expect, it } from "vitest";

import { HTML_CONTENT_SECURITY_POLICY, applySecurityHeaders } from "./security-headers";

function headersAfter(https: boolean) {
  const headers: Record<string, string> = {};
  applySecurityHeaders({ setHeader: (name, value) => (headers[name] = value) }, { https });
  return headers;
}

describe("applySecurityHeaders", () => {
  it("sets the headers every response carries", () => {
    expect(headersAfter(false)).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("adds Strict-Transport-Security when the app is served over https", () => {
    expect(headersAfter(true)["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});

describe("HTML_CONTENT_SECURITY_POLICY", () => {
  it("allows scripts only from the same origin, with no inline script", () => {
    expect(HTML_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(HTML_CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(HTML_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(HTML_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});
