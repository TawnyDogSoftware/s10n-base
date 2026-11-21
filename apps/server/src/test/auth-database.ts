/**
 * A migrated fixture schema for live auth tests: the throwaway schema from live-database.ts with
 * every migration applied, and a Kysely instance working inside it.
 */
import type { Kysely } from "kysely";

import type { DB } from "../infra/postgres/generated/db";
import { migrateUp } from "../infra/postgres/migrator";
import { migrations } from "../infra/postgres/migrations";
import { createDb, createPool } from "../infra/postgres/pool";
import { createFixtureSchema, type FixtureSchema } from "./live-database";

export interface MigratedSchema {
  readonly fixture: FixtureSchema;
  readonly db: Kysely<DB>;
  /** Closes the pool and drops the schema. */
  readonly drop: () => Promise<void>;
}

export async function createMigratedSchema(): Promise<MigratedSchema> {
  const fixture = await createFixtureSchema();
  const db = createDb(
    createPool({
      connectionString: fixture.url,
      max: 4,
      searchPath: fixture.schema,
      onIdleError: () => {},
    }),
  );
  try {
    await migrateUp({ db: db as Kysely<unknown>, schema: fixture.schema, migrations });
  } catch (error) {
    await db.destroy();
    await fixture.drop();
    throw error;
  }
  return {
    fixture,
    db,
    drop: async () => {
      await db.destroy();
      await fixture.drop();
    },
  };
}
