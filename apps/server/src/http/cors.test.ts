import { describe, expect, it } from "vitest";

import { applyCors } from "./cors";

const APP = "https://app.example.com";

function headersAfter(request: { method: string; headers: Record<string, string> }) {
  const headers = new Map<string, string>();
  const decision = applyCors(
    request,
    { setHeader: (name, value) => headers.set(name, value) },
    APP,
  );
  return { decision, headers: Object.fromEntries(headers) };
}

describe("applyCors", () => {
  it("echoes the app's origin with credentials", () => {
    expect(headersAfter({ method: "POST", headers: { origin: APP } })).toEqual({
      decision: "allowed",
      headers: {
        Vary: "Origin",
        "Access-Control-Allow-Origin": APP,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });

  it("answers a preflight from the app's origin with the allowed methods and headers", () => {
    const { decision, headers } = headersAfter({
      method: "OPTIONS",
      headers: { origin: APP, "access-control-request-method": "POST" },
    });

    expect(decision).toBe("preflight-allowed");
    expect(headers).toMatchObject({
      "Access-Control-Allow-Origin": APP,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
    });
  });

  it.each([
    "https://evil.example.com",
    "https://app.example.com.evil.com",
    "null",
    "http://app.example.com",
  ])("sends no CORS headers to %s", (origin) => {
    const { decision, headers } = headersAfter({ method: "POST", headers: { origin } });

    expect(decision).toBe("denied");
    expect(headers).toEqual({ Vary: "Origin" });
  });

  it("denies a preflight from another origin", () => {
    expect(
      headersAfter({
        method: "OPTIONS",
        headers: { origin: "https://evil.example.com", "access-control-request-method": "POST" },
      }).decision,
    ).toBe("preflight-denied");
  });

  it("does not block a request with no Origin, such as curl or a mobile app", () => {
    expect(headersAfter({ method: "POST", headers: {} })).toEqual({
      decision: "no-origin",
      headers: { Vary: "Origin" },
    });
  });
});
