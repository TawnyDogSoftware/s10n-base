/** `bun run deps:update`: see run.ts. */
import path from "node:path";

import { runDependencyUpdate } from "./flow";
import { updateCommand } from "./run";

process.exitCode = await updateCommand(process.argv.slice(2), {
  repoRoot: path.resolve(import.meta.dirname, "../.."),
  env: process.env,
  now: new Date(),
  log: console.log,
  error: console.error,
  flow: runDependencyUpdate,
});
