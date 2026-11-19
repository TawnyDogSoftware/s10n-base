/**
 * The `migrate` entry point's logic: `migrate [up|status|down|reset]`. It connects with a pool of
 * one, retrying the first connection so it can start next to a database that is still booting,
 * runs one command, and returns the exit code. Output is JSON lines on stdout.
 */
import { Effect, Exit, Redacted, type Schedule } from "effect";
import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

import { databaseConfigFromEnv, ServerConfigError } from "./config";
import { pingDatabase, waitForDatabase } from "./infra/postgres/connect";
import { migrations as committedMigrations } from "./infra/postgres/migrations";
import {
  assertCommandAllowed,
  type MigrationCommand,
  parseMigrationCommand,
  runMigrationCommand,
} from "./infra/postgres/migrator";
import { createDb, createPool } from "./infra/postgres/pool";
import { createLogger, type LogWriter } from "./observability/logger";

export interface MigrateCliOptions {
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly write?: LogWriter;
  /** Retry schedule for the first connection. */
  readonly schedule?: Schedule.Schedule<unknown, unknown>;
  /** For tests: the migrations to run and the schema to run them in. */
  readonly migrations?: Readonly<Record<string, Migration>>;
  readonly schema?: string;
}

export async function runMigrateCli(options: MigrateCliOptions): Promise<number> {
  const startupLogger = createLogger({
    level: "info",
    ...(options.write ? { write: options.write } : {}),
  });

  let command: MigrationCommand;
  try {
    command = parseMigrationCommand(options.args);
  } catch (error) {
    startupLogger.error("migrate_usage", { usage: (error as Error).message });
    return 1;
  }

  const configExit = Effect.runSyncExit(databaseConfigFromEnv(options.env));
  if (Exit.isFailure(configExit)) {
    const error = configExit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
    startupLogger.error("config_invalid", {
      error:
        error instanceof ServerConfigError ? { name: error._tag, message: error.message } : error,
    });
    return 1;
  }
  const config = configExit.value;
  const logger = createLogger({
    level: config.logLevel,
    ...(options.write ? { write: options.write } : {}),
  });

  try {
    assertCommandAllowed(command, config.nodeEnv);
  } catch (error) {
    logger.error("migrate_refused", { error });
    return 1;
  }

  const schema = options.schema ?? "public";
  const pool = createPool({
    connectionString: Redacted.value(config.databaseUrl),
    max: 1,
    ...(schema === "public" ? {} : { searchPath: schema }),
    onIdleError: (error) => logger.warn("database_idle_connection_failed", { error }),
  });
  const db = createDb(pool) as Kysely<unknown>;
  try {
    await Effect.runPromise(
      waitForDatabase(() => pingDatabase(db), {
        ...(options.schedule ? { schedule: options.schedule } : {}),
        onAttemptFailed: (error) => logger.warn("database_unavailable", { error }),
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
