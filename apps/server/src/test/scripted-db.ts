/**
 * A Kysely instance for unit tests that answers every query from a script instead of Postgres.
 * Queries compile exactly as they would for Postgres; the test sees each one's SQL and
 * parameters and decides the rows. For the logic around a query: paging, mapping rows, and what
 * happens when no row comes back. Whether the SQL itself is right is the live tests' job.
 */
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";

export interface ScriptedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** The rows a query returns. Throw to make the query fail. */
export type Responder = (query: ScriptedQuery) => ReadonlyArray<Record<string, unknown>>;

export interface ScriptedDb<DB> {
  readonly db: Kysely<DB>;
  /** Every query run so far, in order. */
  readonly queries: ScriptedQuery[];
}

export function scriptedDb<DB>(respond: Responder): ScriptedDb<DB> {
  const queries: ScriptedQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const query = { sql: compiled.sql, parameters: compiled.parameters };
      queries.push(query);
      try {
        return Promise.resolve({ rows: respond(query) as R[] });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    streamQuery() {
      throw new Error("The scripted database does not stream.");
    },
  };
  const driver: Driver = {
    init: () => Promise.resolve(),
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
  };
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, queries };
}
