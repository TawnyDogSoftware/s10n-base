import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/contracts/vitest.config.ts",
  "apps/server/vitest.config.ts",
  "apps/web/vitest.config.ts",
]);
