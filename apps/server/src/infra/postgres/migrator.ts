/**
 * Runs migrations with Kysely's `Migrator`, one process at a time.
 *
 * Kysely creates its bookkeeping tables before it takes its own lock, so two instances started
 * together can race on creating them. Every command that writes therefore runs on one pinned
 * connection holding a Postgres session advisory lock, keyed by the schema, for the whole run.
 */
import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationResultSet, Migrator } from "kysely/migration";

import type { NodeEnv } from "../../config";

export const MIGRATION_COMMANDS = ["up", "status", "down", "reset"] as const;
export type MigrationCommand = (typeof MIGRATION_COMMANDS)[number];

const PRODUCTION_REFUSED: ReadonlySet<MigrationCommand> = new Set(["down", "reset"]);

/** First key of the two-key advisory lock: this repo's migrations. The second is the schema. */
const MIGRATION_LOCK_NAMESPACE = 73_001;

const MIGRATION_TABLE = "kysely_migration";

export interface MigrationTarget {
  readonly db: Kysely<unknown>;
  /** Schema that holds the migrated tables and Kysely's bookkeeping tables. */
  readonly schema: string;
  readonly migrations: Readonly<Record<string, Migration>>;
}

export interface MigrationStatus {
  readonly applied: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<string>;
  /** Applied in the database but not in this build's list: the database is ahead of the code. */
  readonly unknown: ReadonlyArray<string>;
}

/** A migration (or the run around it) failed. `cause` is the error it threw. */
export class MigrationFailedError extends Error {
  override readonly name = "MigrationFailedError";
}

/** Parses the `migrate` command line. No argument means `up`. */
export function parseMigrationCommand(args: ReadonlyArray<string>): MigrationCommand {
  const [command = "up", ...rest] = args;
  const known = MIGRATION_COMMANDS.find((candidate) => candidate === command);
  if (known === undefined || rest.length > 0) {
    throw new Error(`Usage: migrate [${MIGRATION_COMMANDS.join("|")}]`);
  }
  return known;
}

/**
 * Returns the names of the migrations that ran.
 *
 * @throws {MigrationFailedError} with the migration's own error as `cause`.
 */
export function checkMigrationResults(resultSet: MigrationResultSet): ReadonlyArray<string> {
  const results = resultSet.results ?? [];
  if (resultSet.error !== undefined) {
    const failed = results.find((result) => result.status === "Error");
    throw new MigrationFailedError(
      failed === undefined ? "Migration run failed." : `Migration ${failed.migrationName} failed.`,
      { cause: resultSet.error },
    );
  }
  return results
    .filter((result) => result.status === "Success")
    .map((result) => result.migrationName);
}

function createMigrator(db: Kysely<unknown>, target: MigrationTarget): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve({ ...target.migrations }) },
    // Always explicit: without it, Kysely looks for its table in every schema.
    migrationTableSchema: target.schema,
  });
}

/** Runs `operation` on one connection that holds the migration lock for `schema`. */
export async function withMigrationLock<T>(
  target: Pick<MigrationTarget, "db" | "schema">,
  operation: (connection: Kysely<unknown>) => Promise<T>,
): Promise<T> {
  return target.db.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, hashtext(${target.schema}))`.execute(
      connection,
    );
    const unlock = () =>
      sql`select pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, hashtext(${target.schema}))`.execute(
        connection,
      );
    let result: T;
    try {
      result = await operation(connection);
    } catch (error) {
      // Keep the operation's error. If the connection broke, Postgres has released the lock.
      await unlock().catch(() => undefined);
      throw error;
    }
    await unlock();
    return result;
  });
}

/** Applies every pending migration. Returns the names applied. */
export function migrateUp(target: MigrationTarget): Promise<ReadonlyArray<string>> {
  return withMigrationLock(target, async (connection) =>
    checkMigrationResults(await createMigrator(connection, target).migrateToLatest()),
  );
}

/** Reverts the latest applied migration. Returns its name, if one was reverted. */
export function migrateDown(target: MigrationTarget): Promise<ReadonlyArray<string>> {
  return withMigrationLock(target, async (connection) =>
    checkMigrationResults(await createMigrator(connection, target).migrateDown()),
  );
}

/** Drops the schema with everything in it, recreates it empty, and applies every migration. */
export function resetSchema(target: MigrationTarget): Promise<ReadonlyArray<string>> {
  return withMigrationLock(target, async (connection) => {
    await sql`drop schema if exists ${sql.id(target.schema)} cascade`.execute(connection);
    await sql`create schema ${sql.id(target.schema)}`.execute(connection);
    return checkMigrationResults(await createMigrator(connection, target).migrateToLatest());
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

/** Applied, pending and unknown migrations. Read-only: it never creates Kysely's tables. */
export async function migrationStatus(target: MigrationTarget): Promise<MigrationStatus> {
  // Kysely orders migrations by plain code-unit comparison, so the status does too.
  const expected = Object.keys(target.migrations).toSorted(compareCodeUnits);
  const applied = await target.db
    .transaction()
    .setAccessMode("read only")
    .execute(async (trx) => {
      const table = await sql<{ present: boolean }>`
        select exists (
          select 1 from pg_catalog.pg_tables
          where schemaname = ${target.schema} and tablename = ${MIGRATION_TABLE}
        ) as present`.execute(trx);
      if (table.rows[0]?.present !== true) return [];
      const rows = await sql<{ name: string }>`
        select name from ${sql.id(target.schema, MIGRATION_TABLE)} order by timestamp, name`.execute(
        trx,
      );
      return rows.rows.map((row) => row.name);
    });
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  return {
    applied,
    pending: expected.filter((name) => !appliedSet.has(name)),
    unknown: applied.filter((name) => !expectedSet.has(name)),
  };
}

/**
 * @throws {Error} for `down` or `reset` when `nodeEnv` is production. Callers check this before
 * connecting, so a refused command never touches the database.
 */
export function assertCommandAllowed(command: MigrationCommand, nodeEnv: NodeEnv): void {
  if (nodeEnv === "production" && PRODUCTION_REFUSED.has(command)) {
    throw new Error(`"${command}" refuses to run when NODE_ENV is production.`);
  }
}

export interface MigrationCommandOptions extends MigrationTarget {
  readonly nodeEnv: NodeEnv;
  readonly log: (message: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * Runs one command: `up` applies every pending migration, `status` reports without writing,
 * `down` reverts the latest migration, and `reset` drops the schema and migrates it again.
 *
 * @throws {Error} for `down` or `reset` when `nodeEnv` is production, before touching the database.
 * @throws {MigrationFailedError} when a migration fails.
 */
export async function runMigrationCommand(
  command: MigrationCommand,
  options: MigrationCommandOptions,
): Promise<void> {
  assertCommandAllowed(command, options.nodeEnv);
  switch (command) {
    case "up":
      options.log("migrations_applied", {
        schema: options.schema,
        applied: await migrateUp(options),
      });
      return;
    case "down":
      options.log("migration_reverted", {
        schema: options.schema,
        reverted: await migrateDown(options),
      });
      return;
    case "reset":
      options.log("schema_reset", { schema: options.schema, applied: await resetSchema(options) });
      return;
    case "status":
      options.log("migration_status", {
        schema: options.schema,
        ...(await migrationStatus(options)),
      });
      return;
  }
}
