/**
 * The migrator's runs against a scripted database: which statements it sends, in what order,
 * and what it reports. The live tests (migrator.live.test.ts) prove the same against Postgres,
 * including two runs taking turns on the lock.
 */
import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";
import { describe, expect, it, vi } from "vitest";

import { scriptedDb } from "../../test/scripted-db";
import {
  MigrationFailedError,
  migrateDown,
  migrateUp,
  migrationStatus,
  resetSchema,
  runMigrationCommand,
  withMigrationLock,
} from "./migrator";

const LOCK = "select pg_advisory_lock($1, hashtext($2))";
const UNLOCK = "select pg_advisory_unlock($1, hashtext($2))";

function table(name: string): Migration {
  return {
    up: async (db: Kysely<unknown>) => {
      await sql`create table ${sql.id(name)} ()`.execute(db);
    },
    down: async (db: Kysely<unknown>) => {
      await sql`drop table ${sql.id(name)}`.execute(db);
    },
  };
}

const migrations = { "001_widget": table("widget"), "002_gadget": table("gadget") };

/** A database where `applied` migrations have run, answering Kysely's bookkeeping queries. */
function database(applied: readonly string[] = []) {
  return scriptedDb<unknown>((query) =>
    query.sql.startsWith('select "name", "timestamp" from')
      ? applied.map((name, index) => ({ name, timestamp: `2026-11-1${String(index)}` }))
      : [],
  );
}

const statements = (queries: ReadonlyArray<{ sql: string }>) =>
  queries.map((query) => query.sql.trim()).filter((text) => /^(create|drop) /.test(text));

describe("migrateUp", () => {
  it("applies every pending migration in name order, inside the lock", async () => {
    const { db, queries } = database(["001_widget"]);

    expect(await migrateUp({ db, schema: "app", migrations })).toEqual(["002_gadget"]);
    expect(queries[0]?.sql).toBe(LOCK);
    expect(queries[0]?.parameters).toEqual([73_001, "app"]);
    expect(queries.at(-1)?.sql).toBe(UNLOCK);
    expect(statements(queries)).toContain('create table "gadget" ()');
    expect(statements(queries)).not.toContain('create table "widget" ()');
  });

  it("reports the migration that failed, and still releases the lock", async () => {
    const broken: Migration = {
      up: () => Promise.reject(new Error('relation "missing" does not exist')),
    };
    const { db, queries } = database();

    const failure = await migrateUp({
      db,
      schema: "app",
      migrations: { "001_broken": broken },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MigrationFailedError);
    expect((failure as Error).message).toBe("Migration 001_broken failed.");
    expect(queries.at(-1)?.sql).toBe(UNLOCK);
  });
});

describe("migrateDown", () => {
  it("reverts only the latest applied migration", async () => {
    const { db, queries } = database(["001_widget", "002_gadget"]);

    expect(await migrateDown({ db, schema: "app", migrations })).toEqual(["002_gadget"]);
    expect(statements(queries)).toContain('drop table "gadget"');
    expect(statements(queries)).not.toContain('drop table "widget"');
  });
});

describe("resetSchema", () => {
  it("drops and recreates the schema, then applies every migration", async () => {
    const { db, queries } = database();

    expect(await resetSchema({ db, schema: "app", migrations })).toEqual([
      "001_widget",
      "002_gadget",
    ]);
    expect(statements(queries).slice(0, 2)).toEqual([
      'drop schema if exists "app" cascade',
      'create schema "app"',
    ]);
  });
});

describe("withMigrationLock", () => {
  it("releases the lock when the work fails, and keeps the work's error", async () => {
    const { db, queries } = database();

    await expect(
      withMigrationLock({ db, schema: "app" }, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(queries.map((query) => query.sql)).toEqual([LOCK, UNLOCK]);
  });

  it("keeps the work's error when releasing the lock fails too", async () => {
    const { db } = scriptedDb<unknown>((query) => {
      if (query.sql === UNLOCK) throw new Error("connection lost");
      return [];
    });

    await expect(
      withMigrationLock({ db, schema: "app" }, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});

describe("migrationStatus", () => {
  it("calls everything pending when Kysely's table does not exist yet", async () => {
    const { db, queries } = database();

    expect(await migrationStatus({ db, schema: "app", migrations })).toEqual({
      applied: [],
      pending: ["001_widget", "002_gadget"],
      unknown: [],
    });
    expect(statements(queries)).toEqual([]);
  });

  it("splits applied, pending, and applied ones this build does not know", async () => {
    const { db } = scriptedDb<unknown>((query) => {
      if (query.sql.includes("pg_catalog.pg_tables")) return [{ present: true }];
      if (query.sql.includes("order by timestamp, name")) {
        return [{ name: "001_widget" }, { name: "009_from_the_future" }];
      }
      return [];
    });

    expect(await migrationStatus({ db, schema: "app", migrations })).toEqual({
      applied: ["001_widget", "009_from_the_future"],
      pending: ["002_gadget"],
      unknown: ["009_from_the_future"],
    });
  });
});

describe("runMigrationCommand", () => {
  it.each([
    ["up", "migrations_applied", { applied: ["001_widget", "002_gadget"] }],
    ["down", "migration_reverted", { reverted: [] }],
    ["reset", "schema_reset", { applied: ["001_widget", "002_gadget"] }],
    ["status", "migration_status", { pending: ["001_widget", "002_gadget"] }],
  ] as const)("runs %s and logs %s", async (command, message, fields) => {
    const { db } = database();
    const log = vi.fn<(message: string, fields?: Readonly<Record<string, unknown>>) => void>();

    await runMigrationCommand(command, { db, schema: "app", migrations, nodeEnv: "test", log });

    expect(log).toHaveBeenCalledWith(
      message,
      expect.objectContaining({ schema: "app", ...fields }),
    );
  });
});

describe("migrationStatus order", () => {
  it("lists pending migrations by name, whatever order the list gives them in", async () => {
    const { db } = database();

    const status = await migrationStatus({
      db,
      schema: "app",
      migrations: { "002_gadget": table("gadget"), "001_widget": table("widget") },
    });

    expect(status.pending).toEqual(["001_widget", "002_gadget"]);
  });
});
