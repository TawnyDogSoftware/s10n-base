import { describe, expect, it } from "vitest";

import { parseCaptureEndpoint } from "./local-endpoint";

describe("parseCaptureEndpoint", () => {
  it.each([
    ["http://127.0.0.1:8005", { origin: "http://127.0.0.1:8005", host: "127.0.0.1", port: 8005 }],
    ["http://localhost:8005/", { origin: "http://localhost:8005", host: "localhost", port: 8005 }],
    ["http://[::1]:8005", { origin: "http://[::1]:8005", host: "::1", port: 8005 }],
  ])("reads %s", (value, endpoint) => {
    expect(parseCaptureEndpoint(value)).toEqual(endpoint);
  });

  it.each([
    ["", "empty"],
    ["nonsense", "not a URL"],
    ["https://127.0.0.1:8005", "https, which the capture server does not serve"],
    ["http://127.0.0.1", "no port"],
    ["http://127.0.0.1:80", "only the default port"],
    ["http://127.0.0.1:8005/v2", "a path"],
    ["http://ses.example.com:8005", "a host that is not loopback"],
  ])("refuses %j (%s)", (value) => {
    expect(parseCaptureEndpoint(value)).toBeNull();
  });
});
