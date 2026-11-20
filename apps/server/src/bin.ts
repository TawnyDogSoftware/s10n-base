/**
 * The server's entry point (`node dist/bin.mjs`). Reads its config from the environment through
 * Effect `Config`, starts the layers, and stops them on SIGTERM or SIGINT. See process.ts for the
 * exit codes.
 */
import { createLogger } from "./observability/logger";
import { nodeRuntime, runServerProcess } from "./process";
import { startFromEnvironment } from "./server";

await runServerProcess({
  runtime: nodeRuntime(process),
  logger: createLogger({ level: "info" }),
  start: startFromEnvironment,
});
