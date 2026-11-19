/**
 * The `migrate` entry point's logic: `migrate [up|status|down|reset]`. It connects with a pool of
 * one, retrying the first connection so it can start next to a database that is still booting,
 * runs one command, and returns the exit code. Output is JSON lines on stdout.
 */
import { Effect, Exit, Redacted, type Schedule } from "effect";
import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

import { databaseConfigFromEnv, type DatabaseConfig, ServerConfigError } from "./config";
import { pingDatabase, waitForDatabase } from "./infra/postgres/connect";
import { migrations as committedMigrations } from "./infra/postgres/migrations";
import {
  assertCommandAllowed,
  type MigrationCommand,
  parseMigrationCommand,
  runMigrationCommand,
} from "./infra/postgres/migrator";
import { createDb, createPool } from "./infra/postgres/pool";
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
}

/** The database config from `env`, or undefined after logging why it is invalid. */
function readDatabaseConfig(
  env: MigrateCliOptions["env"],
  logger: Logger,
): DatabaseConfig | undefined {
  const exit = Effect.runSyncExit(databaseConfigFromEnv(env));
  if (Exit.isSuccess(exit)) return exit.value;
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
  logger.error("config_invalid", {
    error:
      error instanceof ServerConfigError ? { name: error._tag, message: error.message } : error,
  });
  return undefined;
}

/** Connects with a pool of one, waits for the database, and runs `command`. */
async function runWithDatabase(
  command: MigrationCommand,
  config: DatabaseConfig,
  logger: Logger,
  options: MigrateCliOptions,
): Promise<number> {
  const schema = options.schema ?? "public";
  const pool = createPool({
    connectionString: Redacted.value(config.databaseUrl),
    max: 1,
    ...(schema === "public" ? {} : { searchPath: schema }),
    onIdleError: (error) => {
      logger.warn("database_idle_connection_failed", { error });
    },
  });
  const db = createDb(pool) as Kysely<unknown>;
  try {
    await Effect.runPromise(
      waitForDatabase(() => pingDatabase(db), {
        ...(options.schedule ? { schedule: options.schedule } : {}),
        onAttemptFailed: (error) => {
          logger.warn("database_unavailable", { error });
        },
      }),
    );
    await runMigrationCommand(command, {
      db,
      nodeEnv: config.nodeEnv,
      schema,
      migrations: options.migrations ?? committedMigrations,
      log: logger.info,
    });
    return 0;
  } catch (error) {
    logger.error("migrate_failed", { command, error });
    return 1;
  } finally {
    await db.destroy();
  }
}

export async function runMigrateCli(options: MigrateCliOptions): Promise<number> {
  const writer = options.write ? { write: options.write } : {};
  const startupLogger = createLogger({ level: "info", ...writer });

  let command: MigrationCommand;
  try {
    command = parseMigrationCommand(options.args);
  } catch (error) {
    startupLogger.error("migrate_usage", { usage: (error as Error).message });
    return 1;
  }

  const config = readDatabaseConfig(options.env, startupLogger);
  if (config === undefined) return 1;
  const logger = createLogger({ level: config.logLevel, ...writer });

  try {
    assertCommandAllowed(command, config.nodeEnv);
  } catch (error) {
    logger.error("migrate_refused", { error });
    return 1;
  }
  return runWithDatabase(command, config, logger, options);
}
