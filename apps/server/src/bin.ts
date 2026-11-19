/**
 * The server's entry point (`node dist/bin.mjs`). Reads its config from the environment through
 * Effect `Config`, starts the layers, and stops them on SIGTERM or SIGINT. See process.ts for the
 * exit codes.
 */
import { createLogger } from "./observability/logger";
import { runServerProcess } from "./process";
import { AppConfig, startWithConfigLayer } from "./server";

await runServerProcess({
  runtime: {
    get exitCode() {
      return process.exitCode;
    },
    set exitCode(code) {
      process.exitCode = code;
    },
    on: (signal, listener) => process.on(signal, listener),
    off: (signal, listener) => process.off(signal, listener),
    // Exit once stdout has taken every line written before, so the last log line is not lost.
    exit: (code) => process.stdout.write("", () => process.exit(code)),
  },
  logger: createLogger({ level: "info" }),
  start: async () => {
    const started = await startWithConfigLayer(AppConfig.fromEnvironment);
    return { shutdownTimeoutMs: started.config.shutdownTimeoutMs, stop: started.stop };
  },
});
