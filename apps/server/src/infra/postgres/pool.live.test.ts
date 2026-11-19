import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureSchema, type FixtureSchema } from "../../test/live-database";
import { createDb, createPool } from "./pool";

let fixture: FixtureSchema;

beforeEach(async () => {
  fixture = await createFixtureSchema();
});

afterEach(async () => {
  await fixture.drop();
});

describe("createPool against Postgres", () => {
  it("resolves unqualified names in the search path schema", async () => {
    const pool = createPool({
      connectionString: fixture.url,
      max: 2,
      searchPath: fixture.schema,
      onIdleError: () => {},
    });
    const db = createDb(pool);
    try {
      await sql`create table widget (id int primary key)`.execute(db);

      const result = await fixture.admin.query<{ schemaname: string }>(
        "select schemaname from pg_catalog.pg_tables where tablename = 'widget'",
      );
      expect(result.rows.map((row) => row.schemaname)).toEqual([fixture.schema]);
      const current = await sql<{ schema: string }>`select current_schema() as schema`.execute(db);
      expect(current.rows[0]?.schema).toBe(fixture.schema);
    } finally {
      await db.destroy();
    }
  });

  it("survives an idle connection being killed, reports it, and reconnects", async () => {
    const onIdleError = vi.fn<(error: Error) => void>();
    const pool = createPool({ connectionString: fixture.url, max: 1, onIdleError });
    const db = createDb(pool);
    try {
      const pid = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db);

      await fixture.admin.query("select pg_terminate_backend($1)", [pid.rows[0]?.pid]);
      await vi.waitFor(() => expect(onIdleError).toHaveBeenCalledTimes(1));

      const again = await sql<{ one: number }>`select 1 as one`.execute(db);
      expect(again.rows[0]?.one).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it("cancels a statement that runs past the statement timeout", async () => {
    const pool = createPool({
      connectionString: fixture.url,
      max: 1,
      statementTimeoutMs: 200,
      onIdleError: () => {},
    });
    const db = createDb(pool);
    try {
      await expect(sql`select pg_sleep(2)`.execute(db)).rejects.toMatchObject({
        code: "57014",
      });
    } finally {
      await db.destroy();
    }
  });
});
