/**
 * The live test lane's database fixture. Each suite gets its own schema in the database named by
 * `TEST_DATABASE_URL` and drops it afterwards. Two guards run before any DDL: the URL must name a
 * database ending in `_test`, and the open connection must report that same database, so a
 * mistaken URL can never touch a development or production database.
 */
import { randomBytes } from "node:crypto";

import pg from "pg";

export interface TestDatabaseTarget {
  readonly url: string;
  readonly database: string;
}

const FIXTURE_SCHEMA = /^fixture_([a-z0-9]+)_([a-f0-9]{12})$/;

/**
 * Reads `TEST_DATABASE_URL`. It never falls back to `DATABASE_URL`.
 *
 * @throws {Error} when it is unset or its database name does not end in `_test`.
 */
export function testDatabaseUrl(env: Record<string, string | undefined>): TestDatabaseTarget {
  const url = env.TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error(
      "TEST_DATABASE_URL is not set. The live tests need a database whose name ends in _test; see docs/setup.md.",
    );
  }
  let database: string;
  try {
    database = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  if (!database.endsWith("_test")) {
    throw new Error("The database named by TEST_DATABASE_URL must end in _test.");
  }
  return { url, database };
}

export interface QueryClient {
  query(text: string): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

/** Checks, on the open connection, that the server put it on `expected`, a `_test` database. */
export async function assertConnectedToTestDatabase(
  client: QueryClient,
  expected: string,
): Promise<void> {
  if (!expected.endsWith("_test")) {
    throw new Error(`Refusing to run live tests on ${expected}: its name does not end in _test.`);
  }
  const result = await client.query("select current_database() as current_database");
  const actual = result.rows[0]?.current_database;
  if (actual !== expected) {
    throw new Error(`Refusing to run live tests: connected to ${String(actual)}, not ${expected}.`);
  }
}

/** A new fixture schema name: `fixture_<creation time in base 36>_<random>`. */
export function fixtureSchemaName(now: number = Date.now()): string {
  return `fixture_${now.toString(36)}_${randomBytes(6).toString("hex")}`;
}

/** When a fixture schema was created, or `undefined` for any other schema name. */
export function fixtureSchemaCreatedAt(name: string): number | undefined {
  const match = FIXTURE_SCHEMA.exec(name);
  if (match === null) return undefined;
  const createdAt = Number.parseInt(match[1] ?? "", 36);
  return Number.isSafeInteger(createdAt) ? createdAt : undefined;
}

/** Opens a guarded connection to the test database. */
export async function connectToTestDatabase(
  env: Record<string, string | undefined> = process.env,
): Promise<{ readonly client: pg.Client; readonly target: TestDatabaseTarget }> {
  const target = testDatabaseUrl(env);
  const client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await assertConnectedToTestDatabase(client, target.database);
  } catch (error) {
    await client.end();
    throw error;
  }
  return { client, target };
}

export interface FixtureSchema {
  /** `TEST_DATABASE_URL`. Pass `schema` as the pool's `searchPath` to work inside it. */
  readonly url: string;
  readonly schema: string;
  /** A connection outside the pool under test, for setup and inspection. */
  readonly admin: pg.Client;
  /** Drops the schema and closes `admin`. */
  readonly drop: () => Promise<void>;
}

/** Creates a throwaway schema in the test database. Call `drop` when the suite ends. */
export async function createFixtureSchema(): Promise<FixtureSchema> {
  const { client, target } = await connectToTestDatabase();
  const schema = fixtureSchemaName();
  try {
    await client.query(`create schema "${schema}"`);
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    url: target.url,
    schema,
    admin: client,
    drop: async () => {
      try {
        await client.query(`drop schema if exists "${schema}" cascade`);
      } finally {
        await client.end();
      }
    },
  };
}
