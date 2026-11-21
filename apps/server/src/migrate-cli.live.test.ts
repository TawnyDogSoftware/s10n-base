import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, createPool } from "./infra/postgres/pool";
import { runMigrateCli } from "./migrate-cli";
import { createFixtureSchema, type FixtureSchema } from "./test/live-database";

const migrations: Record<string, Migration> = {
  "001_create_widget": {
    up: async (db) => {
      await db.schema.createTable("widget").addColumn("id", "integer").execute();
    },
    down: async (db) => {
      await db.schema.dropTable("widget").execute();
    },
  },
};

let fixture: FixtureSchema;

beforeEach(async () => {
  fixture = await createFixtureSchema();
});

afterEach(async () => {
  await fixture.drop();
});

async function run(args: string[]) {
  const lines: string[] = [];
  const code = await runMigrateCli({
    args,
    env: { DATABASE_URL: fixture.url },
    write: (line) => {
      lines.push(line);
    },
    migrations,
    schema: fixture.schema,
  });
  return { code, entries: lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe("migrate entry point against Postgres", () => {
  it("applies migrations and reports status", async () => {
    expect(await run(["status"])).toEqual({
      code: 0,
      entries: [
        expect.objectContaining({
          message: "migration_status",
          applied: [],
          pending: ["001_create_widget"],
          unknown: [],
        }),
      ],
    });

    expect(await run([])).toEqual({
      code: 0,
      entries: [
        expect.objectContaining({ message: "migrations_applied", applied: ["001_create_widget"] }),
      ],
    });

    expect((await run(["status"])).entries[0]).toMatchObject({
      applied: ["001_create_widget"],
      pending: [],
    });
  });

  it("refuses to run when the connection puts new tables in another schema, and creates nothing", async () => {
    // The connection's search path names one schema and the command targets another: the
    // migrations would create their tables in the first and record them in the second.
    const other = await createFixtureSchema();
    try {
      const lines: string[] = [];
      const code = await runMigrateCli({
        args: ["up"],
        env: { DATABASE_URL: fixture.url },
        write: (line) => {
          lines.push(line);
        },
        migrations,
        schema: fixture.schema,
        db: createDb(
          createPool({
            connectionString: other.url,
            max: 1,
            searchPath: other.schema,
            onIdleError: () => {},
          }),
        ) as Kysely<unknown>,
      });

      expect(code).toBe(1);
      expect(lines.join("")).toContain("SchemaMismatchError");
      const created = await fixture.admin.query(
        "select table_schema, table_name from information_schema.tables where table_schema = any($1)",
        [[fixture.schema, other.schema]],
      );
      expect(created.rows).toEqual([]);
    } finally {
      await other.drop();
    }
  });
});
