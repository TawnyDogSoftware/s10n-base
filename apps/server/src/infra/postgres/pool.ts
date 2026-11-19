import { Kysely, PostgresDialect, type PostgresPool } from "kysely";
import { Pool } from "pg";

import type { DB } from "./generated/db";

export interface PoolOptions {
  readonly connectionString: string;
  readonly max: number;
  /** Called when an idle pooled connection fails, such as when Postgres restarts. */
  readonly onIdleError: (error: Error) => void;
  /** Schema for unqualified names. The live tests use it to give each suite its own schema. */
  readonly searchPath?: string;
  /** How long to wait for a connection, new or from a full pool. */
  readonly connectTimeoutMs?: number;
  /** Postgres cancels any statement that runs longer. */
  readonly statementTimeoutMs?: number;
  /** How long an unused connection stays open. */
  readonly idleTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

const LOWERCASE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Returns `connectionString` with `search_path` appended to its `options` parameter. It goes into
 * the URL, after any options already there, because `pg` lets URL parameters override pool
 * settings and Postgres applies the last `-c` for a setting.
 *
 * @throws {Error} unless `searchPath` is one lowercase identifier, so it cannot inject options.
 */
export function withSearchPath(connectionString: string, searchPath: string | undefined): string {
  if (searchPath === undefined) return connectionString;
  if (!LOWERCASE_IDENTIFIER.test(searchPath)) {
    throw new Error("searchPath must be a single lowercase identifier.");
  }
  const url = new URL(connectionString);
  const existing = url.searchParams.get("options");
  const setting = `-c search_path=${searchPath}`;
  url.searchParams.set("options", existing === null ? setting : `${existing} ${setting}`);
  return url.toString();
}

/**
 * A connection pool. No connection opens until the first query. When Postgres restarts or the
 * network drops, the pool emits `error` for each idle connection it loses; without a listener
 * Node would crash the process. The pool has already discarded that connection and opens a new
 * one on the next query, so the listener only reports it.
 */
export function createPool(options: PoolOptions): Pool {
  const pool = new Pool({
    connectionString: withSearchPath(options.connectionString, options.searchPath),
    max: options.max,
    connectionTimeoutMillis: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  });
  pool.on("error", options.onIdleError);
  return pool;
}

/** A typed query builder over `pool`. Destroying it ends the pool. */
export function createDb(pool: PostgresPool): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
