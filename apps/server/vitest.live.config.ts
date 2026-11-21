import { defineConfig } from "vitest/config";

// `bun run test:live`: suites that need a real Postgres at TEST_DATABASE_URL. Not part of the
// root projects, so `bun run test` passes with no database. Each suite works in its own schema;
// files still run one at a time, because some suites take database-wide advisory locks.
export default defineConfig({
  test: {
    name: "server-live",
    root: import.meta.dirname,
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
