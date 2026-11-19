/**
 * `bun scripts/with-env.ts <command> [args...]`: runs a command with the local environment
 * (`.env`, or `.env.example` when there is none; see local-env.ts) and exits with its code.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { loadLocalEnv } from "./local-env";

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("Usage: bun scripts/with-env.ts <command> [args...]");
  process.exit(2);
}

const { env } = loadLocalEnv(path.resolve(import.meta.dirname, ".."), process.env);
const child = spawn(command, args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 128));
});
