import fs from "node:fs";
import path from "node:path";

export interface Logger {
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(logDir: string): Logger {
  const logFilePath = path.join(logDir, "server.log");

  function write(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta } : {}),
    });

    fs.appendFileSync(logFilePath, `${entry}\n`);
    const line = `[server:${level}] ${message}`;
    if (level === "error") {
      console.error(line, meta ?? {});
      return;
    }
    console.info(line, meta ?? {});
  }

  return {
    info: (message, meta) => write("info", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}
