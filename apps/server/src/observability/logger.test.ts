import fs from "node:fs";

import { Redacted } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, serializeError } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

const AT = new Date("2026-11-19T10:00:00.000Z");

function captureLines(level: "debug" | "info" | "warn" | "error" = "debug") {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (line) => {
      lines.push(line);
    },
    now: () => AT,
  });
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines, logger, entries };
}

describe("createLogger", () => {
  it("writes one newline-terminated JSON line per call", () => {
    const { lines, logger } = captureLines();

    logger.info("first");
    logger.error("second");

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
    }
  });

  it("writes at, level and message, then the fields", () => {
    const { lines, logger, entries } = captureLines();

    logger.warn("request_slow", { path: "/rpc", durationMs: 12 });

    expect(entries()).toEqual([
      {
        at: "2026-11-19T10:00:00.000Z",
        level: "warn",
        message: "request_slow",
        path: "/rpc",
        durationMs: 12,
      },
    ]);
    expect(lines[0]).toMatch(/^\{"at":.*"level":.*"message":/);
  });

  it("does not let a field replace at, level or message", () => {
    const { logger, entries } = captureLines();

    logger.info("real", { at: "x", level: "error", message: "fake" });

    expect(entries()[0]).toMatchObject({ level: "info", message: "real" });
    expect(entries()[0]?.at).toBe("2026-11-19T10:00:00.000Z");
  });

  it("drops lines below the configured level", () => {
    const { logger, entries } = captureLines("warn");

    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");

    expect(entries().map((entry) => entry.message)).toEqual(["c", "d"]);
  });

  it("adds a child's fields to every line", () => {
    const { logger, entries } = captureLines();

    const child = logger.child({ requestId: "r1" });
    child.info("handled", { status: 200 });
    child.child({ step: 2 }).info("nested");

    expect(entries()).toEqual([
      expect.objectContaining({ message: "handled", requestId: "r1", status: 200 }),
      expect.objectContaining({ message: "nested", requestId: "r1", step: 2 }),
    ]);
  });

  it("serialises errors with their name, message, stack and cause", () => {
    const { logger, entries } = captureLines();
    const error = new TypeError("bad input", { cause: new Error("root") });

    logger.error("request_failed", { error });

    const logged = entries()[0]?.error as Record<string, unknown>;
    expect(logged).toMatchObject({ name: "TypeError", message: "bad input" });
    expect(logged.stack).toContain("bad input");
    expect(logged.cause).toMatchObject({ name: "Error", message: "root" });
  });

  it("serialises a thrown value that is not an Error", () => {
    expect(serializeError("plain")).toEqual({ name: "NonError", message: "plain" });
  });

  it("never writes a redacted value", () => {
    const { lines, logger } = captureLines();

    logger.info("config", { databaseUrl: Redacted.make("postgres://u:pw@h/db") });

    expect(lines[0]).not.toContain("pw@h");
  });

  it("writes to stdout by default", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLogger({ level: "info" }).info("server_started");

    expect(write).toHaveBeenCalledTimes(1);
    const [line] = write.mock.calls[0] ?? [];
    expect(JSON.parse(String(line))).toMatchObject({ level: "info", message: "server_started" });
  });

  it("does not write to the file system", () => {
    const spies = [
      vi.spyOn(fs, "appendFileSync"),
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "mkdirSync"),
      vi.spyOn(fs, "createWriteStream"),
    ];
    const { logger } = captureLines();

    logger.info("one", { a: 1 });
    logger.error("two");

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("serializeError", () => {
  it("leaves out a stack the error does not have", () => {
    const error = new Error("no stack");
    delete error.stack;

    expect(serializeError(error)).toEqual({ name: "Error", message: "no stack" });
  });
});
