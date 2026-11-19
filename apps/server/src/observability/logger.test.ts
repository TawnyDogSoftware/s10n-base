import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function captureLines() {
  const lines: string[] = [];
  const logger = createLogger((line) => {
    lines.push(line);
  });
  return { lines, logger };
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
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });

  it("includes at, level, message and meta", () => {
    const { lines, logger } = captureLines();

    logger.error("request_failed", { path: "/rpc" });

    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(entry).toEqual({
      at: expect.any(String),
      level: "error",
      message: "request_failed",
      meta: { path: "/rpc" },
    });
    expect(new Date(entry.at as string).toISOString()).toBe(entry.at);
  });

  it("omits meta when none is given", () => {
    const { lines, logger } = captureLines();

    logger.info("server_started");

    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(entry).toEqual({ at: expect.any(String), level: "info", message: "server_started" });
    expect(entry).not.toHaveProperty("meta");
  });

  it("writes to stdout by default", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLogger().info("server_started");

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
