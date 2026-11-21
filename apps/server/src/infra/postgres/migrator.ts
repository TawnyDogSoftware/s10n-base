/**
 * Runs migrations with Kysely's `Migrator`, one process at a time.
 *
 * Kysely creates its bookkeeping tables before it takes its own lock, so two instances started
 * together can race on creating them. Every command that writes therefore runs on one pinned
 * connection holding a Postgres session advisory lock, keyed by the schema, for the whole run.
 */
import { Data } from "effect";
import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationResultSet, Migrator } from "kysely/migration";

import type { NodeEnv } from "../../config";

const MIGRATION_COMMANDS = ["up", "status", "down", "reset"] as const;
export type MigrationCommand = (typeof MIGRATION_COMMANDS)[number];

const PRODUCTION_REFUSED: ReadonlySet<MigrationCommand> = new Set(["down", "reset"]);

/** First key of the two-key advisory lock: this repo's migrations. The second is the schema. */
const MIGRATION_LOCK_NAMESPACE = 73_001;

const MIGRATION_TABLE = "kysely_migration";
const MIGRATION_LOCK_TABLE = "kysely_migration_lock";

export interface MigrationTarget {
  readonly db: Kysely<unknown>;
  /** Schema that holds the migrated tables and Kysely's bookkeeping tables. */
  readonly schema: string;
  readonly migrations: Readonly<Record<string, Migration>>;
  /**
   * The role the server connects as, when it is not the role that migrates. After applying
   * migrations, it is granted what the server needs on the schema and nothing more.
   */
  readonly appRole?: string | undefined;
}

export interface MigrationStatus {
  readonly applied: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<string>;
  /** Applied in the database but not in this build's list: the database is ahead of the code. */
  readonly unknown: ReadonlyArray<string>;
}

/** The database misses migrations this build needs: the server refuses to start on it. */
export class MigrationsPendingError extends Data.TaggedError("MigrationsPendingError")<{
  readonly pending: ReadonlyArray<string>;
}> {
  override get message(): string {
    return `The database has not applied ${this.pending.join(", ")}, which this build needs. Apply the pending migrations before starting the server: \`bun run db:migrate\` in a checkout, or \`node apps/server/dist/migrate.mjs up\` from a build or the image.`;
  }
}

/** Which migrations the database has applied could not be read. */
export class MigrationCheckError extends Data.TaggedError("MigrationCheckError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Could not read which migrations the database has applied.";
  }
}

/** A migration (or the run around it) failed. `cause` is the error it threw. */
export class MigrationFailedError extends Error {
  override readonly name = "MigrationFailedError";
}

/**
 * The connection would create tables in a schema other than the one the command targets: the
 * migrations' unqualified names resolve through the search path, while the migrator's own
 * tables and lock are in the target schema.
 */
export class SchemaMismatchError extends Error {
  override readonly name = "SchemaMismatchError";
}

/**
 * @throws {SchemaMismatchError} unless the first schema of `db`'s search path, where its
 * unqualified names create tables, is `schema`.
 */
async function assertConnectionSchema(db: Kysely<unknown>, schema: string): Promise<void> {
  const result = await sql<{ schema: string | null }>`select current_schema() as schema`.execute(
    db,
  );
  const actual = result.rows[0]?.schema ?? null;
  if (actual === schema) return;
  const where = actual === null ? "no schema" : `schema "${actual}"`;
  throw new SchemaMismatchError(
    `The connection's search path creates tables in ${where}, not in "${schema}". Make "${schema}" the first schema of the search path.`,
  );
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

/**
 * Grants `role` what the server needs on `schema`: to use the schema, to read and write rows in
 * its tables and to use its sequences, and the same on tables and sequences that later
 * migrations create (default privileges belong to the role running this, the one that migrates).
 * Nothing that changes the schema. The migrator's own tables are read-only to it: the server
 * reads them at startup to refuse a database that misses a migration, so the grant to write
 * names every other table rather than granting on all of them and revoking. Every statement runs
 * in one transaction, so a failure part way grants nothing, and each is idempotent, so it runs
 * after every `up`.
 */
async function grantAppRole(
  connection: Kysely<unknown>,
  schema: string,
  role: string,
): Promise<void> {
  const inSchema = sql.id(schema);
  const to = sql.id(role);
  const bookkeeping = sql.join([
    sql.id(schema, MIGRATION_TABLE),
    sql.id(schema, MIGRATION_LOCK_TABLE),
  ]);
  await connection.transaction().execute(async (trx) => {
    // What `all tables in schema` covers: tables, views, materialized views and foreign tables.
    const tables = await sql<{ name: string }>`
      select c.relname as name
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${schema} and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and c.relname not in (${MIGRATION_TABLE}, ${MIGRATION_LOCK_TABLE})
      order by c.relname`.execute(trx);
    const names = tables.rows.map((row) => sql.id(schema, row.name));
    const statements = [
      sql`grant usage on schema ${inSchema} to ${to}`,
      ...(names.length === 0
        ? []
        : [sql`grant select, insert, update, delete on ${sql.join(names)} to ${to}`]),
      sql`grant select on ${bookkeeping} to ${to}`,
      // Removes write access a default privilege or an earlier version of this grant gave.
      sql`revoke insert, update, delete, truncate on ${bookkeeping} from ${to}`,
      sql`grant usage on all sequences in schema ${inSchema} to ${to}`,
      sql`alter default privileges in schema ${inSchema} grant select, insert, update, delete on tables to ${to}`,
      sql`alter default privileges in schema ${inSchema} grant usage on sequences to ${to}`,
    ];
    for (const statement of statements) await statement.execute(trx);
  });
}

/** Applies every pending migration, then grants the app role. Returns the names applied. */
export function migrateUp(target: MigrationTarget): Promise<ReadonlyArray<string>> {
  return withMigrationLock(target, async (connection) => {
    const applied = checkMigrationResults(
      await createMigrator(connection, target).migrateToLatest(),
    );
    if (target.appRole !== undefined) await grantAppRole(connection, target.schema, target.appRole);
    return applied;
  });
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
    const applied = checkMigrationResults(
      await createMigrator(connection, target).migrateToLatest(),
    );
    if (target.appRole !== undefined) await grantAppRole(connection, target.schema, target.appRole);
    return applied;
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
 * The migrations in `migrations` that the database has not applied, in the order they would run.
 * Reads the migrator's table in the connection's current schema (the first schema of its search
 * path, where the server's unqualified names resolve), as the server sees the database, and never
 * creates it. A migrator's table further along the search path describes another schema, so it
 * is not read. Migrations the database has that this build does not know are not counted: an
 * older build may run against a newer database while a release rolls back.
 */
export async function pendingMigrations(
  db: Kysely<unknown>,
  migrations: Readonly<Record<string, Migration>>,
): Promise<ReadonlyArray<string>> {
  const expected = Object.keys(migrations).toSorted(compareCodeUnits);
  // `schema` is null only when no schema of the search path exists, and then `present` is false.
  const located = await sql<{ schema: string; present: boolean }>`
    select current_schema() as schema,
      to_regclass(quote_ident(current_schema()) || '.' || ${sql.lit(MIGRATION_TABLE)}) is not null as present`.execute(
    db,
  );
  const table = located.rows[0];
  if (table?.present !== true) return expected;
  const rows = await sql<{
    name: string;
  }>`select name from ${sql.id(table.schema, MIGRATION_TABLE)}`.execute(db);
  const applied = new Set(rows.rows.map((row) => row.name));
  return expected.filter((name) => !applied.has(name));
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

function grantedTo(role: string | undefined): { grantedTo?: string } {
  return role === undefined ? {} : { grantedTo: role };
}

/**
 * Runs one command: `up` applies every pending migration, `status` reports without writing,
 * `down` reverts the latest migration, and `reset` drops the schema and migrates it again.
 *
 * @throws {Error} for `down` or `reset` when `nodeEnv` is production, before touching the database.
 * @throws {SchemaMismatchError} when the connection would create tables outside `schema`, before
 * changing anything.
 * @throws {MigrationFailedError} when a migration fails.
 */
export async function runMigrationCommand(
  command: MigrationCommand,
  options: MigrationCommandOptions,
): Promise<void> {
  assertCommandAllowed(command, options.nodeEnv);
  await assertConnectionSchema(options.db, options.schema);
  switch (command) {
    case "up":
      options.log("migrations_applied", {
        schema: options.schema,
        applied: await migrateUp(options),
        ...grantedTo(options.appRole),
      });
      return;
    case "down":
      options.log("migration_reverted", {
        schema: options.schema,
        reverted: await migrateDown(options),
      });
      return;
    case "reset":
      options.log("schema_reset", {
        schema: options.schema,
        applied: await resetSchema(options),
        ...grantedTo(options.appRole),
      });
      return;
    case "status":
      options.log("migration_status", {
        schema: options.schema,
        ...(await migrationStatus(options)),
      });
      return;
  }
}
