/**
 * `bun scripts/with-env.main.ts <command> [args...]`: runs a command with the local environment
 * (`.env`, or `.env.example` when there is none; see local-env.ts) and exits with its code.
 */
import path from "node:path";

import { runWithEnv } from "./local-env";

process.exitCode = await runWithEnv(
  process.argv.slice(2),
  path.resolve(import.meta.dirname, ".."),
  process.env,
  console.error,
);
