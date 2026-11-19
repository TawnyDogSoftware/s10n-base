import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Redacted, Schedule, Schema } from "effect";
import type { PostgresPool, PostgresPoolClient } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineRpc } from "@s10n-base/contracts";

import type { ServerConfig } from "./config";
import { defineHandler } from "./rpc/dispatcher";
import { startServer, type StartedServer } from "./server";

/** A stand-in for pg.Pool that records what happens to it and can hold queries back. */
function createFakePool(events: string[]) {
  let gate: Promise<void> | undefined;
  let failing = false;
  const client: PostgresPoolClient = {
    query: (async () => {
      await gate;
      if (failing) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      return { command: "SELECT", rowCount: 1, rows: [{ "?column?": 1 }] };
    }) as unknown as PostgresPoolClient["query"],
    release: () => {},
  };
  const pool: PostgresPool & { holdQueries: () => () => void; fail: (value: boolean) => void } = {
    options: {},
    connect: () => Promise.resolve(client),
    end: () => {
      events.push("pool:end");
      return Promise.resolve();
    },
    holdQueries: () => {
      let release = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        gate = undefined;
        release();
      };
    },
    fail: (value) => {
      failing = value;
    },
  };
  return pool;
}

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    appName: "S10N Base",
    version: "0.0.0",
    nodeEnv: "test",
    appOrigin: "http://localhost:5173",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: Redacted.make("postgres://u:p@127.0.0.1:9/db"),
    databasePoolMax: 1,
    trustedProxyHops: 0,
    requestBodyLimitBytes: 1024,
    shutdownTimeoutMs: 2000,
    logLevel: "debug",
    webDistDir: path.join(os.tmpdir(), "s10n-no-web-build"),
    ...overrides,
  };
}

const Empty = Schema.Struct({});
const slow = defineRpc({ method: "fixture.slow", auth: "public", payload: Empty, success: Empty });

let started: StartedServer | undefined;

afterEach(async () => {
  await started?.stop();
  started = undefined;
});

/** Starts a server with a handler for fixture.slow that waits until `finish` is called. */
async function startWithSlowMethod(events: string[], config: Partial<ServerConfig> = {}) {
  const pool = createFakePool(events);
  let finish = () => {};
  const handlerStarted = vi.fn();
  const handler = defineHandler(slow, async () => {
    events.push("request:start");
    handlerStarted();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    events.push("request:end");
    return {};
  });
  const logs: Array<Record<string, unknown>> = [];
  started = await startServer(testConfig(config), {
    createPool: () => pool,
    handlers: [handler],
    write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>),
  });
  const base = `http://127.0.0.1:${started.port}`;
  const call = () =>
    fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "fixture.slow", payload: {} }),
    });
  return { pool, base, call, handlerStarted, finish: () => finish(), logs };
}

describe("startServer", () => {
  it("serves on the port it reports and checks the database before it starts", async () => {
    const events: string[] = [];
    const { base } = await startWithSlowMethod(events);

    const health = await fetch(`${base}/health`);
    const ready = await fetch(`${base}/ready`);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it("lets a request in flight finish, then closes the pool, in that order", async () => {
    const events: string[] = [];
    const { call, handlerStarted, finish } = await startWithSlowMethod(events);
    const server = started!;
    started = undefined;

    const inFlight = call();
    await vi.waitFor(() => expect(handlerStarted).toHaveBeenCalled());
    const stopping = server.stop().then((result) => {
      events.push("stopped");
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toEqual(["request:start"]);

    finish();
    const response = await inFlight;
    const result = await stopping;

    expect(response.status).toBe(200);
    expect(result).toEqual({ forced: false });
    expect(events).toEqual(["request:start", "request:end", "pool:end", "stopped"]);
  });

  it("stops accepting connections once stopping", async () => {
    const events: string[] = [];
    const { base } = await startWithSlowMethod(events);
    const server = started!;
    started = undefined;

    await server.stop();

    await expect(fetch(`${base}/health`)).rejects.toThrow();
  });

  it("answers /ready 503 when shutdown starts while the check is running", async () => {
    const events: string[] = [];
    const { base, pool } = await startWithSlowMethod(events);
    const server = started!;
    started = undefined;

    const release = pool.holdQueries();
    const ready = fetch(`${base}/ready`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stopping = server.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    const response = await ready;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, status: "shutting_down" });
    await stopping;
  });

  it("answers /ready 503 when the database stops answering, and recovers", async () => {
    const events: string[] = [];
    const { base, pool } = await startWithSlowMethod(events);

    pool.fail(true);
    const down = await fetch(`${base}/ready`);
    pool.fail(false);
    const up = await fetch(`${base}/ready`);

    expect(down.status).toBe(503);
    expect(up.status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("force-closes a request still running at the deadline and reports a forced stop", async () => {
    const events: string[] = [];
    const { call, handlerStarted, logs } = await startWithSlowMethod(events, {
      shutdownTimeoutMs: 300,
    });
    const server = started!;
    started = undefined;

    const stuck = call().then(
      () => "answered",
      () => "connection closed",
    );
    await vi.waitFor(() => expect(handlerStarted).toHaveBeenCalled());
    const startedAt = Date.now();
    const result = await server.stop();

    expect(result).toEqual({ forced: true });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(290);
    expect(await stuck).toBe("connection closed");
    expect(events).toContain("pool:end");
    expect(logs.map((line) => line.message)).toContain("http_server_forced_close");
  });

  it("fails to start when the database cannot be reached, and closes the pool", async () => {
    const events: string[] = [];
    const pool = createFakePool(events);
    pool.fail(true);

    await expect(
      startServer(testConfig(), {
        createPool: () => pool,
        connectSchedule: Schedule.recurs(1),
        write: () => {},
      }),
    ).rejects.toMatchObject({ _tag: "DatabaseUnavailableError" });
    expect(events).toEqual(["pool:end"]);
  });

  it("stops only once, however often stop is called", async () => {
    const events: string[] = [];
    await startWithSlowMethod(events);
    const server = started!;
    started = undefined;

    const results = await Promise.all([server.stop(), server.stop()]);

    expect(results).toEqual([{ forced: false }, { forced: false }]);
    expect(events.filter((event) => event === "pool:end")).toHaveLength(1);
  });

  it("creates no file when it starts and stops", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-base-server-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const events: string[] = [];
      const { base } = await startWithSlowMethod(events);
      await fetch(`${base}/health`);
      await started?.stop();
      started = undefined;

      expect(fs.readdirSync(home)).toEqual([]);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
