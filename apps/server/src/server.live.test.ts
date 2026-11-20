import { Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "./config";
import { createPool } from "./infra/postgres/pool";
import { startServer, type StartedServer } from "./server";
import { createMigratedSchema } from "./test/auth-database";
import { testServerConfig } from "./test/config";
import { createFixtureSchema } from "./test/live-database";

let started: StartedServer | undefined;
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await started?.stop();
  started = undefined;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function config(url: string): ServerConfig {
  return testServerConfig({
    databaseUrl: Redacted.make(url),
    databasePoolMax: 2,
    logLevel: "error",
  });
}

/** A real pool working in `schema`. */
function poolIn(url: string, schema: string) {
  return () =>
    createPool({ connectionString: url, max: 2, searchPath: schema, onIdleError: () => {} });
}

describe("server against Postgres", () => {
  it("answers /ready 200 with a real pool, and stops cleanly", async () => {
    const schema = await createMigratedSchema();
    cleanups.push(schema.drop);
    started = await startServer(config(schema.fixture.url), {
      write: () => {},
      createPool: poolIn(schema.fixture.url, schema.fixture.schema),
    });
    const base = `http://127.0.0.1:${String(started.port)}`;

    const ready = await fetch(`${base}/ready`);

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, status: "ready" });
    const server = started;
    started = undefined;
    expect(await server.stop()).toEqual({ forced: false });
  });

  it("refuses to start on a database nobody has migrated", async () => {
    const fixture = await createFixtureSchema();
    cleanups.push(fixture.drop);

    await expect(
      startServer(config(fixture.url), {
        write: () => {},
        createPool: poolIn(fixture.url, fixture.schema),
      }),
    ).rejects.toMatchObject({ _tag: "MigrationsPendingError", pending: ["001_auth"] });
  });
});
