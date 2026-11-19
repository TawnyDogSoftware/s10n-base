/**
 * What the database command-line tools (`migrate`, `set-role`) share: reading the database
 * config from the environment, and opening a one-connection database.
 */
import { Effect, Redacted } from "effect";
import type { Kysely } from "kysely";

import { type DatabaseConfig, databaseConfigFromEnv } from "./config";
import type { DB } from "./infra/postgres/generated/db";
import { createDb, createPool, warnOnIdleError } from "./infra/postgres/pool";
import type { Logger } from "./observability/logger";

/** The database config from `env`, or undefined after logging why it is invalid. */
export function readDatabaseConfig(
  env: Record<string, string | undefined>,
  logger: Logger,
): DatabaseConfig | undefined {
  const result = Effect.runSync(Effect.result(databaseConfigFromEnv(env)));
  if (result._tag === "Success") return result.success;
  // The message lists every problem and never a value; the stack would only add noise.
  logger.error("config_invalid", {
    error: { name: result.failure._tag, message: result.failure.message },
  });
  return undefined;
}

/**
 * A database on one connection, made when the first query runs. `schema`, when given, is the
 * search path, as the live tests use it.
 */
export function openCliDatabase(
  config: DatabaseConfig,
  logger: Logger,
  schema: string | undefined,
): Kysely<DB> {
  return createDb(
    createPool({
      connectionString: Redacted.value(config.databaseUrl),
      max: 1,
      ...(schema === undefined ? {} : { searchPath: schema }),
      onIdleError: warnOnIdleError(logger),
    }),
  );
}
