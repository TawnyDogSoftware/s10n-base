/** `bun run coverage:exclusions`: see coverage-exclusions.ts. */
import path from "node:path";

import { runCoverageExclusionCheck } from "./coverage-exclusions";

process.exitCode = runCoverageExclusionCheck(
  path.resolve(import.meta.dirname, "../.."),
  console.log,
);
