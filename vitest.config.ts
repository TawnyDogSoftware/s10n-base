import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "scripts/vitest.config.ts",
    ],
    // One merged report over every project. The threshold lives here and nowhere else.
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      // Every pattern here is in scripts/quality/coverage-exclusions.ts with its reason, and
      // `bun run coverage:exclusions` fails if the two lists differ.
      exclude: [
        "**/*.test.{ts,tsx}",
        "apps/*/src/test/**",
        "packages/client/src/test-fetch.ts",
        "packages/client/src/testing/**",
        "**/*.d.ts",
        "apps/server/src/infra/postgres/generated/**",
        "apps/mobile/src/app/**",
        "apps/server/src/bin.ts",
        "apps/server/src/migrate.ts",
        "apps/server/src/set-role.ts",
        "apps/web/src/main.tsx",
        "scripts/**/*.main.ts",
      ],
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
