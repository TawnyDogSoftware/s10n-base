import type { Migration } from "kysely/migration";

import { auth } from "./001_auth";

/**
 * Every migration, in order. Migrations are numbered and append-only: once merged, a file is
 * never edited or removed, and a schema change is always a new, higher-numbered file listed here,
 * for example `"001_create_profiles": createProfiles`. The map is explicit rather than read from
 * the directory so the bundled `migrate` entry point contains every migration.
 *
 * After adding one, run `bun run db:migrate` and `bun run db:generate` to update the types.
 */
export const migrations: Readonly<Record<string, Migration>> = {
  "001_auth": auth,
};
