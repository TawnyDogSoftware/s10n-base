import os from "node:os";
import path from "node:path";

import { Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "./config";
import { startServer, type StartedServer } from "./server";
import { testDatabaseUrl } from "./test/live-database";

let started: StartedServer | undefined;

afterEach(async () => {
  await started?.stop();
  started = undefined;
});

function config(): ServerConfig {
  return {
    appName: "S10N Base",
    version: "0.0.0",
    nodeEnv: "test",
    appOrigin: "http://localhost:5173",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: Redacted.make(testDatabaseUrl(process.env).url),
    databasePoolMax: 2,
    trustedProxyHops: 0,
    requestBodyLimitBytes: 1024,
    shutdownTimeoutMs: 2000,
    logLevel: "error",
    webDistDir: path.join(os.tmpdir(), "s10n-no-web-build"),
  };
}

describe("server against Postgres", () => {
  it("answers /ready 200 with a real pool, and stops cleanly", async () => {
    started = await startServer(config(), { write: () => {} });
    const base = `http://127.0.0.1:${started.port}`;

    const ready = await fetch(`${base}/ready`);

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, status: "ready" });
    const server = started;
    started = undefined;
    expect(await server.stop()).toEqual({ forced: false });
  });
});
