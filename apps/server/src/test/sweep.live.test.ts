import { afterEach, describe, expect, it } from "vitest";

import { connectToTestDatabase, fixtureSchemaName } from "./live-database";
import { SWEEP_MIN_AGE_MS, sweepFixtureSchemas } from "./sweep";

const created: string[] = [];

afterEach(async () => {
  const { client } = await connectToTestDatabase();
  try {
    for (const name of created.splice(0))
      await client.query(`drop schema if exists "${name}" cascade`);
  } finally {
    await client.end();
  }
});

describe("sweepFixtureSchemas", () => {
  it("drops fixture schemas older than the minimum age and keeps newer ones and other schemas", async () => {
    const now = Date.now();
    const stale = fixtureSchemaName(now - SWEEP_MIN_AGE_MS - 1000);
    const fresh = fixtureSchemaName(now - 1000);
    const other = `keep_${fresh.slice(-12)}`;
    created.push(stale, fresh, other);
    const { client } = await connectToTestDatabase();
    try {
      for (const name of created) await client.query(`create schema "${name}"`);

      const dropped = await sweepFixtureSchemas(client, { now, minAgeMs: SWEEP_MIN_AGE_MS });

      expect(dropped).toContain(stale);
      expect(dropped).not.toContain(fresh);
      const remaining = await client.query<{ nspname: string }>(
        "select nspname from pg_catalog.pg_namespace where nspname = any($1)",
        [created],
      );
      expect(remaining.rows.map((row) => row.nspname).toSorted()).toEqual(
        [fresh, other].toSorted(),
      );
    } finally {
      await client.end();
    }
  });
});
