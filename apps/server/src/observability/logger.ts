export interface Logger {
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

/** Receives one newline-terminated JSON line per log entry. */
export type LogWriter = (line: string) => void;

function writeToStdout(line: string) {
  process.stdout.write(line);
}

export function createLogger(writer: LogWriter = writeToStdout): Logger {
  function write(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta } : {}),
    });
    writer(`${entry}\n`);
  }

  return {
    info: (message, meta) => write("info", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
