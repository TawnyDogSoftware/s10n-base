import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureSchema, type FixtureSchema } from "../../test/live-database";
import {
  MigrationFailedError,
  migrateDown,
  migrateUp,
  migrationStatus,
  resetSchema,
  withMigrationLock,
} from "./migrator";
import { createDb, createPool } from "./pool";

function createTable(name: string): Migration {
  return {
    up: async (db) => {
      await db.schema
        .createTable(name)
        .addColumn("id", "integer", (column) => column.primaryKey())
        .execute();
    },
    down: async (db) => {
      await db.schema.dropTable(name).execute();
    },
  };
}

const fixtureMigrations: Record<string, Migration> = {
  "001_create_widget": createTable("widget"),
  "002_create_gadget": createTable("gadget"),
};

let fixture: FixtureSchema;
const opened: Array<Kysely<unknown>> = [];

function openDb(max = 2): Kysely<unknown> {
  const db = createDb(
    createPool({
      connectionString: fixture.url,
      max,
      searchPath: fixture.schema,
      onIdleError: () => {},
    }),
  ) as Kysely<unknown>;
  opened.push(db);
  return db;
}

async function tables(): Promise<string[]> {
  const result = await fixture.admin.query<{ tablename: string }>(
    "select tablename from pg_catalog.pg_tables where schemaname = $1 order by tablename",
    [fixture.schema],
  );
  return result.rows.map((row) => row.tablename);
}

beforeEach(async () => {
  fixture = await createFixtureSchema();
});

afterEach(async () => {
  for (const db of opened.splice(0)) await db.destroy();
  await fixture.drop();
});

describe("migrator against Postgres", () => {
  it("reports status without creating anything", async () => {
    const status = await migrationStatus({
      db: openDb(),
      schema: fixture.schema,
      migrations: fixtureMigrations,
    });

    expect(status).toEqual({
      applied: [],
      pending: ["001_create_widget", "002_create_gadget"],
      unknown: [],
    });
    expect(await tables()).toEqual([]);
  });

  it("applies, reports, reverts and resets", async () => {
    const target = { db: openDb(), schema: fixture.schema, migrations: fixtureMigrations };

    expect(await migrateUp(target)).toEqual(["001_create_widget", "002_create_gadget"]);
    expect(await migrateUp(target)).toEqual([]);
    expect(await tables()).toEqual([
      "gadget",
      "kysely_migration",
      "kysely_migration_lock",
      "widget",
    ]);
    expect(await migrationStatus(target)).toEqual({
      applied: ["001_create_widget", "002_create_gadget"],
      pending: [],
      unknown: [],
    });

    expect(await migrateDown(target)).toEqual(["002_create_gadget"]);
    expect(await tables()).not.toContain("gadget");
    expect((await migrationStatus(target)).pending).toEqual(["002_create_gadget"]);

    await fixture.admin.query(`create table "${fixture.schema}".stray (id int)`);
    expect(await resetSchema(target)).toEqual(["001_create_widget", "002_create_gadget"]);
    expect(await tables()).not.toContain("stray");
  });

  it("names applied migrations this build does not know", async () => {
    await migrateUp({ db: openDb(), schema: fixture.schema, migrations: fixtureMigrations });

    const status = await migrationStatus({
      db: openDb(),
      schema: fixture.schema,
      migrations: { "001_create_widget": fixtureMigrations["001_create_widget"]! },
    });

    expect(status).toEqual({
      applied: ["001_create_widget", "002_create_gadget"],
      pending: [],
      unknown: ["002_create_gadget"],
    });
  });

  it("reports a failing migration's cause and rolls back the whole run", async () => {
    const target = {
      db: openDb(),
      schema: fixture.schema,
      migrations: {
        "001_create_widget": fixtureMigrations["001_create_widget"]!,
        "002_broken": {
          up: async (db: Kysely<unknown>) => {
            await sql`alter table no_such_table add column x int`.execute(db);
          },
        },
      },
    };

    const failure = await migrateUp(target).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(MigrationFailedError);
    expect((failure as Error).message).toBe("Migration 002_broken failed.");
    expect((failure as Error).cause).toMatchObject({ code: "42P01" });
    // Kysely runs one transaction per run on Postgres, so the migration before it is undone too.
    expect((await migrationStatus(target)).applied).toEqual([]);
    expect(await tables()).not.toContain("widget");
  });

  it("makes two concurrent runs take turns on the lock", async () => {
    const events: string[] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withMigrationLock({ db: openDb(1), schema: fixture.schema }, async () => {
      events.push("first:start");
      await held;
      events.push("first:end");
    });
    // Wait until the first run holds the lock.
    await expect.poll(() => events).toEqual(["first:start"]);

    const second = migrateUp({
      db: openDb(1),
      schema: fixture.schema,
      migrations: fixtureMigrations,
    }).then((applied) => events.push(`second:applied ${applied.length}`));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toEqual(["first:start"]);

    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:applied 2"]);
  });

  it("lets two migrators started together apply each migration once", async () => {
    const runs = await Promise.all([
      migrateUp({ db: openDb(1), schema: fixture.schema, migrations: fixtureMigrations }),
      migrateUp({ db: openDb(1), schema: fixture.schema, migrations: fixtureMigrations }),
    ]);

    expect(runs.flat().sort()).toEqual(["001_create_widget", "002_create_gadget"]);
  });
});
