import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The live lane needs Postgres and has its own config (vitest.live.config.ts).
    exclude: ["src/**/*.live.test.ts"],
  },
});
