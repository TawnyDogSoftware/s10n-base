/**
 * The server's entry point (`node dist/bin.mjs`). Reads its config from the environment through
 * Effect `Config`, starts the layers, and stops them on SIGTERM or SIGINT. See process.ts for the
 * exit codes.
 */
import { createLogger } from "./observability/logger";
import { runServerProcess } from "./process";
import { AppConfig, startWithConfigLayer } from "./server";

await runServerProcess({
  runtime: process,
  logger: createLogger({ level: "info" }),
  start: async () => {
    const started = await startWithConfigLayer(AppConfig.fromEnvironment);
    return { shutdownTimeoutMs: started.config.shutdownTimeoutMs, stop: started.stop };
  },
});
