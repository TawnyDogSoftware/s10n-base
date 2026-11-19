import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./observability/logger";
import { runServerProcess, type ProcessRuntime, type RunningServer } from "./process";

function createRuntime() {
  const emitter = new EventEmitter();
  const runtime: ProcessRuntime & { exits: number[]; emit: (signal: string) => void } = {
    exitCode: undefined,
    on: (signal, listener) => emitter.on(signal, listener),
    off: (signal, listener) => emitter.off(signal, listener),
    exit: (code) => {
      runtime.exits.push(code);
    },
    exits: [],
    emit: (signal) => {
      emitter.emit(signal);
    },
  };
  return { runtime, listeners: (signal: string) => emitter.listenerCount(signal) };
}

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger, messages: () => lines.map((line) => line.message) };
}

const noop = () => {};

function deferred<T>() {
  let resolve: (value: T) => void = noop;
  let reject: (error: unknown) => void = noop;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runServerProcess", () => {
  it("registers SIGTERM and SIGINT before starting", async () => {
    const { runtime, listeners } = createRuntime();
    const seen: number[] = [];

    await runServerProcess({
      runtime,
      logger: capture().logger,
      start: () => {
        seen.push(listeners("SIGTERM"), listeners("SIGINT"));
        return Promise.resolve({
          shutdownTimeoutMs: 1000,
          stop: () => Promise.resolve({ forced: false }),
        });
      },
    });

    expect(seen).toEqual([1, 1]);
  });

  it("stops on SIGTERM and exits 0 after a clean stop", async () => {
    const { runtime, listeners } = createRuntime();
    const output = capture();
    const stop = vi.fn<RunningServer["stop"]>(() => Promise.resolve({ forced: false }));
    await runServerProcess({
      runtime,
      logger: output.logger,
      start: () => Promise.resolve({ shutdownTimeoutMs: 1000, stop }),
    });

    runtime.emit("SIGTERM");
    await vi.runAllTimersAsync();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(runtime.exitCode).toBe(0);
    expect(runtime.exits).toEqual([0]);
    expect(output.messages()).toEqual(["shutdown_started", "shutdown_complete"]);
    expect(listeners("SIGTERM")).toBe(0);
  });

  it("exits 1 after a forced stop", async () => {
    const { runtime } = createRuntime();
    await runServerProcess({
      runtime,
      logger: capture().logger,
      start: () =>
        Promise.resolve({ shutdownTimeoutMs: 1000, stop: () => Promise.resolve({ forced: true }) }),
    });

    runtime.emit("SIGINT");
    await vi.runAllTimersAsync();

    expect(runtime.exitCode).toBe(1);
    expect(runtime.exits).toEqual([1]);
  });

  it("ignores a second signal during shutdown", async () => {
    const { runtime } = createRuntime();
    const output = capture();
    const stopping = deferred<{ forced: boolean }>();
    const stop = vi.fn<RunningServer["stop"]>(() => stopping.promise);
    await runServerProcess({
      runtime,
      logger: output.logger,
      start: () => Promise.resolve({ shutdownTimeoutMs: 1000, stop }),
    });

    runtime.emit("SIGTERM");
    runtime.emit("SIGINT");
    runtime.emit("SIGTERM");
    stopping.resolve({ forced: false });
    await vi.runAllTimersAsync();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(
      output.messages().filter((message) => message === "shutdown_already_in_progress"),
    ).toHaveLength(2);
    expect(runtime.exitCode).toBe(0);
  });

  it("logs one line and exits 1 when startup fails", async () => {
    const { runtime, listeners } = createRuntime();
    const output = capture();

    await runServerProcess({
      runtime,
      logger: output.logger,
      start: () => Promise.reject(new Error("Could not connect to the database.")),
    });

    expect(runtime.exitCode).toBe(1);
    expect(runtime.exits).toEqual([1]);
    expect(output.lines).toMatchObject([
      {
        level: "error",
        message: "startup_failed",
        error: { message: "Could not connect to the database." },
      },
    ]);
    expect(listeners("SIGTERM")).toBe(0);
  });

  it("stops once startup finishes when the signal came during startup", async () => {
    const { runtime } = createRuntime();
    const starting = deferred<{
      shutdownTimeoutMs: number;
      stop: () => Promise<{ forced: boolean }>;
    }>();
    const stop = vi.fn<RunningServer["stop"]>(() => Promise.resolve({ forced: false }));
    const running = runServerProcess({
      runtime,
      logger: capture().logger,
      start: () => starting.promise,
    });

    runtime.emit("SIGTERM");
    starting.resolve({ shutdownTimeoutMs: 1000, stop });
    await running;
    await vi.runAllTimersAsync();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(runtime.exitCode).toBe(0);
  });

  it("exits 1 when stopping throws", async () => {
    const { runtime } = createRuntime();
    const output = capture();
    await runServerProcess({
      runtime,
      logger: output.logger,
      start: () =>
        Promise.resolve({
          shutdownTimeoutMs: 1000,
          stop: () => Promise.reject(new Error("pool hung")),
        }),
    });

    runtime.emit("SIGTERM");
    await vi.runAllTimersAsync();

    expect(runtime.exitCode).toBe(1);
    expect(runtime.exits).toEqual([1]);
    expect(output.messages()).toContain("shutdown_failed");
  });

  it("exits 1 when shutdown hangs past twice the deadline plus a margin", async () => {
    const { runtime } = createRuntime();
    const output = capture();
    await runServerProcess({
      runtime,
      logger: output.logger,
      start: () =>
        Promise.resolve({
          shutdownTimeoutMs: 1000,
          stop: () => new Promise<{ forced: boolean }>(() => {}),
        }),
    });

    runtime.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(2 * 1000 + 4_999);
    expect(runtime.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.exits).toEqual([1]);
    expect(output.messages()).toContain("shutdown_timed_out");
  });

  it("sets exit code 1 as soon as shutdown starts, so an emptied event loop never exits 0 early", async () => {
    const { runtime } = createRuntime();
    await runServerProcess({
      runtime,
      logger: capture().logger,
      start: () =>
        Promise.resolve({
          shutdownTimeoutMs: 1000,
          stop: () => new Promise<{ forced: boolean }>(() => {}),
        }),
    });

    runtime.emit("SIGTERM");

    expect(runtime.exitCode).toBe(1);
  });
});
