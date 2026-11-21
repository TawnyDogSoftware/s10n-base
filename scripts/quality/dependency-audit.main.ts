/** `bun run deps:audit`: see dependency-audit.ts. */
import path from "node:path";

import { runDependencyAudit } from "./dependency-audit";

process.exitCode = runDependencyAudit(
  path.resolve(import.meta.dirname, "../.."),
  new Date().toISOString().slice(0, 10),
  console.log,
);
