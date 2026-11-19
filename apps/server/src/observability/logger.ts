/**
 * Structured logs: one JSON object per line on stdout, at every level. Each line has `at`,
 * `level` and `message`, then the fields. Nothing else in the server writes to the console.
 */
import type { LogLevel } from "../config";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly debug: (message: string, fields?: LogFields) => void;
  readonly info: (message: string, fields?: LogFields) => void;
  readonly warn: (message: string, fields?: LogFields) => void;
  readonly error: (message: string, fields?: LogFields) => void;
  /** A logger that adds `fields` to every line, such as a request id. */
  readonly child: (fields: LogFields) => Logger;
}

/** Receives one newline-terminated JSON line per log entry. */
export type LogWriter = (line: string) => void;

export interface LoggerOptions {
  readonly level: LogLevel;
  /** Defaults to stdout. */
  readonly write?: LogWriter | undefined;
  readonly now?: () => Date;
}

const SEVERITY: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };
const RESERVED = new Set(["at", "level", "message"]);
const MAX_CAUSE_DEPTH = 5;

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: unknown;
  readonly cause?: SerializedError;
}

/** An error as plain data, since `JSON.stringify(new Error())` is `{}`. */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: String(error) };
  }
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(code === undefined ? {} : { code }),
    ...(error.cause === undefined || depth >= MAX_CAUSE_DEPTH
      ? {}
      : { cause: serializeError(error.cause, depth + 1) }),
  };
}

function writeToStdout(line: string) {
  process.stdout.write(line);
}

function toJsonValue(value: unknown): unknown {
  return value instanceof Error ? serializeError(value) : value;
}

export function createLogger(options: LoggerOptions, bound: LogFields = {}): Logger {
  const write = options.write ?? writeToStdout;
  const now = options.now ?? (() => new Date());
  const threshold = SEVERITY[options.level];

  function log(level: LogLevel, message: string, fields?: LogFields) {
    if (SEVERITY[level] < threshold) return;
    const entry: Record<string, unknown> = { at: now().toISOString(), level, message };
    for (const source of [bound, fields ?? {}]) {
      for (const [key, value] of Object.entries(source)) {
        if (!RESERVED.has(key)) entry[key] = toJsonValue(value);
      }
    }
    write(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug: (message, fields) => {
      log("debug", message, fields);
    },
    info: (message, fields) => {
      log("info", message, fields);
    },
    warn: (message, fields) => {
      log("warn", message, fields);
    },
    error: (message, fields) => {
      log("error", message, fields);
    },
    child: (fields) => createLogger(options, { ...bound, ...fields }),
  };
}
