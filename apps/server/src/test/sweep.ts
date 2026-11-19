/**
 * `bun run db:test:sweep`: drops fixture schemas that live test runs left behind when they were
 * killed before cleaning up. Only schemas older than ten minutes are dropped, so a run in
 * progress keeps its own.
 */
import { connectToTestDatabase, fixtureSchemaCreatedAt, type QueryClient } from "./live-database";

export const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

export async function sweepFixtureSchemas(
  client: QueryClient,
  options: { readonly now: number; readonly minAgeMs: number },
): Promise<ReadonlyArray<string>> {
  const result = await client.query(
    "select nspname from pg_catalog.pg_namespace where nspname like 'fixture\\_%' order by nspname",
  );
  const stale = result.rows
    .map((row) => String(row.nspname))
    .filter((name) => {
      const createdAt = fixtureSchemaCreatedAt(name);
      return createdAt !== undefined && options.now - createdAt >= options.minAgeMs;
    });
  for (const name of stale) {
    // The name matched the fixture pattern, so it is a plain lowercase identifier.
    await client.query(`drop schema if exists "${name}" cascade`);
  }
  return stale;
}

if (import.meta.main) {
  const { client, target } = await connectToTestDatabase();
  try {
    const dropped = await sweepFixtureSchemas(client, {
      now: Date.now(),
      minAgeMs: SWEEP_MIN_AGE_MS,
    });
    process.stdout.write(
      `${JSON.stringify({ message: "fixture_schemas_swept", database: target.database, dropped })}\n`,
    );
  } finally {
    await client.end();
  }
}
