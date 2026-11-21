/**
 * The `migrate` entry point's logic: `migrate [up|status|down|reset]`. It connects as
 * `MIGRATION_DATABASE_URL`'s role when that is set, else `DATABASE_URL`'s, with a pool of one,
 * retrying the first connection so it can start next to a database that is still booting, runs
 * one command, and returns the exit code. After `up`, it grants `DATABASE_APP_ROLE` what the
 * server needs, when that is set. Output is JSON lines on stdout.
 */
import { Effect, type Schedule } from "effect";
import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

import type { MigrationConfig } from "./config";
import { closeCliDatabase, openCliDatabase, readMigrationConfig } from "./database-cli";
import { pingDatabase, waitForDatabase } from "./infra/postgres/connect";
import { migrations as committedMigrations } from "./infra/postgres/migrations";
import {
  assertCommandAllowed,
  type MigrationCommand,
  parseMigrationCommand,
  runMigrationCommand,
} from "./infra/postgres/migrator";
import { createLogger, type Logger, type LogWriter } from "./observability/logger";

export interface MigrateCliOptions {
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly write?: LogWriter;
  /** Retry schedule for the first connection. */
  readonly schedule?: Schedule.Schedule<unknown>;
  /** For tests: the migrations to run and the schema to run them in. */
  readonly migrations?: Readonly<Record<string, Migration>>;
  readonly schema?: string;
  /** For tests: a database to use instead of connecting to `DATABASE_URL`. */
  readonly db?: Kysely<unknown>;
}

/** Connects with a pool of one, waits for the database, and runs `command`. */
async function runWithDatabase(
  command: MigrationCommand,
  config: MigrationConfig,
  logger: Logger,
  options: MigrateCliOptions,
): Promise<number> {
  const schema = options.schema ?? "public";
  let db: Kysely<unknown> | undefined;
  try {
    const opened =
      options.db ?? (openCliDatabase(config, logger, options.schema) as Kysely<unknown>);
    db = opened;
    await Effect.runPromise(
      waitForDatabase(() => pingDatabase(opened), {
        ...(options.schedule ? { schedule: options.schedule } : {}),
        onAttemptFailed: (error) => {
          logger.warn("database_unavailable", { error });
        },
      }),
    );
    await runMigrationCommand(command, {
      db: opened,
      nodeEnv: config.nodeEnv,
      schema,
      migrations: options.migrations ?? committedMigrations,
      appRole: config.appRole,
      log: logger.info,
    });
    return 0;
  } catch (error) {
    logger.error("migrate_failed", { command, error });
    return 1;
  } finally {
    if (db !== undefined) await closeCliDatabase(db, logger);
  }
}

export async function runMigrateCli(options: MigrateCliOptions): Promise<number> {
  const startupLogger = createLogger({ level: "info", write: options.write });

  let command: MigrationCommand;
  try {
    command = parseMigrationCommand(options.args);
  } catch (error) {
    startupLogger.error("migrate_usage", { usage: (error as Error).message });
    return 1;
  }

  const config = readMigrationConfig(options.env, startupLogger);
  if (config === undefined) return 1;
  const logger = createLogger({ level: config.logLevel, write: options.write });

  try {
    assertCommandAllowed(command, config.nodeEnv);
  } catch (error) {
    logger.error("migrate_refused", { error });
    return 1;
  }
  return runWithDatabase(command, config, logger, options);
}
