import { describe, expect, it } from "vitest";

import { webDevServer } from "./web-dev-server";

describe("webDevServer", () => {
  it.each([
    [{}, "localhost", 5173],
    [{ APP_URL: "http://localhost:5173" }, "localhost", 5173],
    [{ APP_URL: "http://laptop.example.com:5173" }, "laptop.example.com", 5173],
    [{ APP_URL: "http://[::1]:5173" }, "::1", 5173],
    [{ APP_URL: "http://localhost" }, "localhost", 80],
    [{ APP_URL: "https://computer-name:8445" }, "127.0.0.1", 5173],
    [{ APP_URL: "https://computer-name:8445", WEB_DEV_HOST: " 0.0.0.0 " }, "0.0.0.0", 5173],
    [{ APP_URL: "http://localhost:5173", WEB_DEV_PORT: "5180" }, "localhost", 5180],
    [{ APP_URL: "http://localhost:5173", WEB_DEV_HOST: "", WEB_DEV_PORT: " " }, "localhost", 5173],
  ])("with %j listens on %s:%s", (env, host, port) => {
    expect(webDevServer(env)).toMatchObject({ host, port });
  });

  it("answers APP_URL's host name, so a forwarder can pass it", () => {
    expect(webDevServer({ APP_URL: "https://computer-name:8445" }).allowedHosts).toEqual([
      "computer-name",
    ]);
  });

  it.each(["0", "65536", "51.5", "port"])("refuses WEB_DEV_PORT=%s", (value) => {
    expect(() => webDevServer({ WEB_DEV_PORT: value })).toThrow(
      `WEB_DEV_PORT must be a port number from 1 to 65535, not ${value}.`,
    );
  });
});
