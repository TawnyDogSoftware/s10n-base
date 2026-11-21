import { Data, Effect, Schedule } from "effect";
import { type Kysely, sql } from "kysely";

/** The database could not be reached. `cause` is the last connection error. */
export class DatabaseUnavailableError extends Data.TaggedError("DatabaseUnavailableError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Could not connect to the database.";
  }
}

/**
 * How long to keep trying the first connection: every half second for up to 30 seconds, long
 * enough for a database container that is still starting.
 */
const FIRST_CONNECTION_RETRY = Schedule.spaced("500 millis").pipe(
  Schedule.upTo({ duration: "30 seconds" }),
);

/** SQLSTATE codes that mean "try again shortly": the server is starting, or full. */
const TRANSIENT_SQLSTATES = new Set(["57P03", "53300"]);
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Whether waiting could fix a connection error. Network errors (no code, or a Node `E...` code)
 * and a starting or full server are transient; a wrong password or a missing database is not.
 */
export function isTransientConnectionError(error: unknown): boolean {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== "string") return true;
  if (SQLSTATE.test(code)) return TRANSIENT_SQLSTATES.has(code);
  return true;
}

export interface WaitForDatabaseOptions {
  readonly schedule?: Schedule.Schedule<unknown>;
  /** Called with each transient failure, including the last one before giving up. */
  readonly onAttemptFailed?: (error: unknown) => void;
}

/** Runs `ping` until it succeeds, retrying transient failures on `schedule`. */
export function waitForDatabase(
  ping: () => Promise<unknown>,
  options: WaitForDatabaseOptions = {},
): Effect.Effect<void, DatabaseUnavailableError> {
  const attempt = Effect.tryPromise({
    try: ping,
    catch: (cause) => new DatabaseUnavailableError({ cause }),
  });
  return attempt.pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (isTransientConnectionError(error.cause)) options.onAttemptFailed?.(error.cause);
      }),
    ),
    Effect.retry({
      schedule: options.schedule ?? FIRST_CONNECTION_RETRY,
      while: (error) => isTransientConnectionError(error.cause),
    }),
    Effect.asVoid,
  );
}

/** One round trip to the database. */
export function pingDatabase(db: Kysely<unknown>): Promise<unknown> {
  return sql`select 1`.execute(db);
}
