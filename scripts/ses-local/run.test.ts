import { describe, expect, it, vi } from "vitest";

import { listenAddress, onProcessInterrupt, runSesLocal } from "./run";

describe("listenAddress", () => {
  it("reads the host and port from SES_ENDPOINT", () => {
    expect(listenAddress("http://127.0.0.1:8005")).toEqual({ host: "127.0.0.1", port: 8005 });
    expect(listenAddress("http://[::1]:8005")).toEqual({ host: "::1", port: 8005 });
  });

  it.each([undefined, "", "https://127.0.0.1:8005", "http://127.0.0.1", "nonsense"])(
    "refuses %j",
    (value) => {
      expect(() => listenAddress(value)).toThrow(/SES_ENDPOINT/);
    },
  );
});

const noop = () => {};

function io() {
  const lines: string[] = [];
  let interrupt: () => void = noop;
  return {
    lines,
    interrupt: () => {
      interrupt();
    },
    io: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(`! ${line}`),
      onInterrupt: (stop: () => void) => {
        interrupt = stop;
      },
    },
  };
}

describe("runSesLocal", () => {
  it("captures email at SES_ENDPOINT until interrupted, then stops and exits 0", async () => {
    const run = io();

    const running = runSesLocal({ SES_ENDPOINT: "http://127.0.0.1:0" }, run.io);
    await vi.waitFor(() => {
      expect(run.lines[0]).toMatch(/^ses-local: capturing SES email at http:\/\/127\.0\.0\.1:\d+/);
    });
    const url = /at (\S+);/.exec(run.lines[0] ?? "")?.[1] ?? "";
    expect((await fetch(`${url}/health-check`)).status).toBe(200);
    run.interrupt();

    expect(await running).toBe(0);
    await expect(fetch(`${url}/health-check`)).rejects.toThrow("fetch failed");
  });

  it("exits 1 with the reason when it cannot start", async () => {
    const run = io();

    expect(await runSesLocal({}, run.io)).toBe(1);
    expect(run.lines).toEqual([
      "! ses-local: SES_ENDPOINT must be set to the capture server's address, such as http://127.0.0.1:8005.",
    ]);
  });
});

describe("onProcessInterrupt", () => {
  it("calls stop on Ctrl-C and on SIGTERM, listening for each once", () => {
    const stop = vi.fn<() => void>();
    const before = process.listenerCount("SIGINT");

    onProcessInterrupt(stop);
    process.emit("SIGINT");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGINT")).toBe(before);
    process.emit("SIGTERM");
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
