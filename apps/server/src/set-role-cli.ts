/**
 * `bun run auth:set-role <email> <role>` (or `node dist/set-role.mjs <email> <role>` in a
 * deployment): sets a user's role, which is how a project creates its first admin. It refuses a
 * role the app does not know and an email no user has. The change applies to the user's next
 * request: the role is read from the database on every session lookup.
 */
import { Effect, Exit, Redacted } from "effect";
import { type Kysely, sql } from "kysely";

import { Role } from "@s10n-base/contracts";

import { databaseConfigFromEnv, ServerConfigError } from "./config";
import type { DB } from "./infra/postgres/generated/db";
import { createDb, createPool } from "./infra/postgres/pool";
import { createLogger, type LogWriter } from "./observability/logger";

const USAGE = `usage: auth:set-role <email> <${Role.literals.join("|")}>`;

class UnknownUserError extends Error {
  override readonly name = "UnknownUserError";
}

/**
 * Reads `<email> <role>`.
 *
 * @throws {Error} with the usage line when there are not exactly two arguments or the role is
 * not one of the app's roles.
 */
export function parseSetRoleArgs(args: ReadonlyArray<string>): { email: string; role: Role } {
  const [email, role, ...rest] = args;
  if (email === undefined || email.trim() === "" || role === undefined || rest.length > 0) {
    throw new Error(USAGE);
  }
  if (!(Role.literals as ReadonlyArray<string>).includes(role)) {
    throw new Error(`Unknown role "${role}". ${USAGE}`);
  }
  return { email: email.trim(), role: role as Role };
}

/**
 * Sets the role of the user with `email` (case does not matter; Better Auth stores addresses in
 * lower case). Returns the user's id.
 *
 * @throws {UnknownUserError} when no user has that email.
 */
export async function setUserRole(db: Kysely<DB>, email: string, role: Role): Promise<string> {
  const updated = await db
    .updateTable("ba_user")
    .set({ role, updated_at: sql`now()` })
    .where(sql<boolean>`lower(email) = lower(${email})`)
    .returning("id")
    .executeTakeFirst();
  if (updated === undefined) throw new UnknownUserError("No user has that email address.");
  return updated.id;
}

export interface SetRoleCliOptions {
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly write?: LogWriter;
  /** For tests: the schema the tables are in. */
  readonly schema?: string;
}

/** Runs the command and returns the exit code. Output is JSON lines on stdout. */
export async function runSetRoleCli(options: SetRoleCliOptions): Promise<number> {
  const logger = createLogger({
    level: "info",
    ...(options.write ? { write: options.write } : {}),
  });
  let parsed: { email: string; role: Role };
  try {
    parsed = parseSetRoleArgs(options.args);
  } catch (error) {
    logger.error("set_role_usage", { usage: (error as Error).message });
    return 2;
  }
  const configExit = Effect.runSyncExit(databaseConfigFromEnv(options.env));
  if (Exit.isFailure(configExit)) {
    const error = configExit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
    logger.error("config_invalid", {
      error:
        error instanceof ServerConfigError ? { name: error._tag, message: error.message } : error,
    });
    return 1;
  }
  const db = createDb(
    createPool({
      connectionString: Redacted.value(configExit.value.databaseUrl),
      max: 1,
      ...(options.schema === undefined ? {} : { searchPath: options.schema }),
      onIdleError: (error) => {
        logger.warn("database_idle_connection_failed", { error });
      },
    }),
  );
  try {
    const userId = await setUserRole(db, parsed.email, parsed.role);
    logger.info("role_set", { userId, role: parsed.role });
    return 0;
  } catch (error) {
    logger.error("set_role_failed", { error });
    return 1;
  } finally {
    await db.destroy();
  }
}
