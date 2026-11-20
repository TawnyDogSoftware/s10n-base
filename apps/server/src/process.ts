/**
 * Process-level startup and shutdown. Signal handlers are registered before startup, so a signal
 * during startup is not lost; the first SIGTERM or SIGINT stops the server, and later ones are
 * logged and ignored. Exit codes: 0 after a clean stop, 1 after a forced stop, a failed stop or
 * a failed startup.
 *
 * The process exits explicitly once it is done rather than waiting for the event loop to empty:
 * under `bun --watch` (the dev script) an emptied loop leaves the process running.
 */
import type { Logger } from "./observability/logger";

export interface ProcessRuntime {
  exitCode: number | string | null | undefined;
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  off(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  /** Ends the process with `code`, after any log output already written. */
  exit(code: number): unknown;
}

export interface RunningServer {
  readonly shutdownTimeoutMs: number;
  readonly stop: () => Promise<{ readonly forced: boolean }>;
}

export interface ServerProcessOptions {
  readonly start: () => Promise<RunningServer>;
  readonly runtime: ProcessRuntime;
  readonly logger: Logger;
}

/**
 * A Node process as a `ProcessRuntime`. `exit` waits until stdout has taken every line written
 * before it, so the last log line is not lost.
 */
export function nodeRuntime(node: NodeJS.Process): ProcessRuntime {
  return {
    get exitCode() {
      return node.exitCode;
    },
    set exitCode(code) {
      node.exitCode = code;
    },
    on: (signal, listener) => node.on(signal, listener),
    off: (signal, listener) => node.off(signal, listener),
    exit: (code) => node.stdout.write("", () => node.exit(code)),
  };
}

const SIGNALS = ["SIGTERM", "SIGINT"] as const;
/** Added to twice the deadline (HTTP drain, then pool close) before the process gives up. */
const HARD_STOP_MARGIN_MS = 5_000;

export async function runServerProcess(options: ServerProcessOptions): Promise<void> {
  const { runtime, logger } = options;
  let running: RunningServer | undefined;
  // An object, so TypeScript does not narrow it to its first value across the await below.
  const shutdown = { requested: false };

  const removeHandlers = () => {
    for (const signal of SIGNALS) runtime.off(signal, onSignal);
  };

  // Runs once: a second signal is turned away by onSignal, and the stop after startup runs only
  // when no signal could reach a running server.
  const stop = (server: RunningServer) => {
    // Until the stop completes cleanly, an exit for any reason is a failure.
    runtime.exitCode = 1;
    const hardStop = setTimeout(
      () => {
        logger.error("shutdown_timed_out");
        runtime.exit(1);
      },
      2 * server.shutdownTimeoutMs + HARD_STOP_MARGIN_MS,
    );
    hardStop.unref();
    server.stop().then(
      (result) => {
        clearTimeout(hardStop);
        removeHandlers();
        logger.info("shutdown_complete", { forced: result.forced });
        runtime.exitCode = result.forced ? 1 : 0;
        runtime.exit(result.forced ? 1 : 0);
      },
      (error: unknown) => {
        clearTimeout(hardStop);
        removeHandlers();
        logger.error("shutdown_failed", { error });
        runtime.exitCode = 1;
        runtime.exit(1);
      },
    );
  };

  function onSignal(signal?: string) {
    if (shutdown.requested) {
      logger.warn("shutdown_already_in_progress", { signal });
      return;
    }
    shutdown.requested = true;
    logger.info("shutdown_started", { signal });
    if (running !== undefined) stop(running);
  }

  for (const signal of SIGNALS) runtime.on(signal, onSignal);

  try {
    running = await options.start();
  } catch (error) {
    removeHandlers();
    logger.error("startup_failed", { error });
    runtime.exitCode = 1;
    runtime.exit(1);
    return;
  }
  if (shutdown.requested) stop(running);
}
