import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  type DevIo,
  devProcesses,
  localInboxUrl,
  processDevIo,
  runCommand,
  runDev,
  supervise,
  type Supervised,
} from "./dev";

function node(name: string, source: string): Supervised {
  return { name, child: spawn("node", ["-e", source], { stdio: "ignore" }) };
}

const RUN_UNTIL_SIGTERM =
  "setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(0));";

describe("localInboxUrl", () => {
  it("is the capture server's page when SES_ENDPOINT is set, and undefined otherwise", () => {
    expect(localInboxUrl({ SES_ENDPOINT: "http://127.0.0.1:8005" })).toBe("http://127.0.0.1:8005/");
    expect(localInboxUrl({ SES_ENDPOINT: "" })).toBeUndefined();
    expect(localInboxUrl({})).toBeUndefined();
  });
});

describe("supervise", () => {
  it("stops every child when interrupted and returns 0", async () => {
    const children = [node("server", RUN_UNTIL_SIGTERM), node("web", RUN_UNTIL_SIGTERM)];

    const code = await supervise(children, new Promise((resolve) => setTimeout(resolve, 300)));

    expect(code).toBe(0);
    for (const { child } of children) expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });

  it("stops the others when one child exits on its own, and returns its code", async () => {
    const web = node("web", RUN_UNTIL_SIGTERM);

    const code = await supervise([node("server", "process.exit(3)"), web], new Promise(() => {}));

    expect(code).toBe(3);
    expect(web.child.exitCode ?? web.child.signalCode).not.toBeNull();
  });

  it("kills a child that ignores SIGTERM after the grace period", async () => {
    const stubborn = node("web", "setInterval(() => {}, 1000); process.on('SIGTERM', () => {});");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const code = await supervise([stubborn], Promise.resolve(), 300);

    expect(code).toBe(0);
    expect(stubborn.child.signalCode).toBe("SIGKILL");
  });
});

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repo root with only an `.env.example` holding `example`. */
function rootWith(example: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "dev-"));
  roots.push(root);
  writeFileSync(path.join(root, ".env.example"), example);
  return root;
}

describe("devProcesses", () => {
  it("runs the capture server only when SES_ENDPOINT is set, then the API and web servers", () => {
    const withCapture = devProcesses(
      { SES_ENDPOINT: "http://127.0.0.1:8005" },
      "/repo",
      "/bin/bun",
    );

    expect(withCapture).toEqual([
      {
        name: "ses-local",
        command: "/bin/bun",
        args: ["scripts/ses-local/run.main.ts"],
        cwd: "/repo",
      },
      {
        name: "server",
        command: "/bin/bun",
        args: ["--watch", "src/bin.ts"],
        cwd: "/repo/apps/server",
      },
      {
        name: "web",
        command: "/repo/apps/web/node_modules/.bin/vite",
        args: [],
        cwd: "/repo/apps/web",
      },
    ]);
    expect(devProcesses({}, "/repo", "/bin/bun").map((each) => each.name)).toEqual([
      "server",
      "web",
    ]);
  });
});

const noop = () => {};

/** A DevIo that records what it was asked to do and starts short node processes instead. */
function fakeIo(root: string, overrides: Partial<DevIo> = {}) {
  const lines: string[] = [];
  const runs: string[] = [];
  const started: string[] = [];
  let interrupt: () => void = noop;
  const io: DevIo = {
    root,
    bun: "/bin/bun",
    env: {},
    onInterrupt: (stop) => {
      interrupt = stop;
    },
    log: (line) => lines.push(line),
    error: (line) => lines.push(`error: ${line}`),
    run: (command, args) => {
      runs.push([command, ...args].join(" "));
      return Promise.resolve();
    },
    start: (devProcess) => {
      started.push(devProcess.name);
      return node(devProcess.name, RUN_UNTIL_SIGTERM);
    },
    ...overrides,
  };
  return {
    io,
    lines,
    runs,
    started,
    interrupt: () => {
      interrupt();
    },
  };
}

describe("runDev", () => {
  it("starts the database, migrates, starts each process, and stops them all on Ctrl-C", async () => {
    const fake = fakeIo(
      rootWith("APP_URL=http://localhost:5173\nSES_ENDPOINT=http://127.0.0.1:8005\n"),
    );

    const running = runDev(fake.io);
    await vi.waitFor(() => {
      expect(fake.started).toHaveLength(3);
    });
    fake.interrupt();

    expect(await running).toBe(0);
    expect(fake.runs).toEqual([
      "docker compose -f docker-compose.local.yml up -d --wait",
      "/bin/bun apps/server/src/migrate.ts up",
    ]);
    expect(fake.started).toEqual(["ses-local", "server", "web"]);
    expect(fake.lines).toEqual([
      "bun dev: using .env.example",
      "bun dev: open http://localhost:5173",
      "bun dev: emails are captured, not sent; inbox: http://127.0.0.1:8005/",
    ]);
  });

  it("says where to look when APP_URL is not set, and starts no capture server without SES_ENDPOINT", async () => {
    const fake = fakeIo(rootWith(""));

    const running = runDev(fake.io);
    await vi.waitFor(() => {
      expect(fake.started).toEqual(["server", "web"]);
    });
    fake.interrupt();

    expect(await running).toBe(0);
    expect(fake.lines).toContain("bun dev: open the APP_URL origin");
  });

  it("stops before starting anything when a setup step fails, and exits 1", async () => {
    const fake = fakeIo(rootWith(""), {
      run: () => Promise.reject(new Error("docker compose up exited with code 1")),
    });

    expect(await runDev(fake.io)).toBe(1);
    expect(fake.started).toEqual([]);
    expect(fake.lines.at(-1)).toBe("error: bun dev: docker compose up exited with code 1");
  });
});

describe("runCommand", () => {
  it("resolves when the command exits with 0 and throws with its code otherwise", async () => {
    const options = { cwd: tmpdir(), env: { PATH: process.env.PATH ?? "" } };

    await expect(runCommand("node", ["-e", "process.exit(0)"], options)).resolves.toBeUndefined();
    await expect(runCommand("node", ["-e", "process.exit(4)"], options)).rejects.toThrow(
      "node -e process.exit(4) exited with code 4",
    );
  });
});

describe("processDevIo", () => {
  it("runs commands in the repo root and starts processes where they say", async () => {
    const io = processDevIo(tmpdir());
    const env = { PATH: process.env.PATH ?? "" };

    await expect(io.run("node", ["-e", "process.exit(0)"], env)).resolves.toBeUndefined();
    const { child } = io.start(
      { name: "x", command: "node", args: ["-e", "process.exit(5)"], cwd: tmpdir() },
      env,
    );
    const [code] = (await once(child, "exit")) as [number];
    expect(code).toBe(5);
    expect(io.bun).toBe(process.execPath);
    expect(io.env).toBe(process.env);
  });

  it("calls stop on SIGINT or SIGTERM, and writes lines to the console", () => {
    const io = processDevIo(tmpdir());
    const stop = vi.fn<() => void>();
    const before = { int: process.listeners("SIGINT"), term: process.listeners("SIGTERM") };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      io.onInterrupt(stop);
      process.emit("SIGINT");
      process.emit("SIGTERM");
      io.log("a line");
      io.error("a problem");

      expect(stop).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith("a line");
      expect(error).toHaveBeenCalledWith("a problem");
    } finally {
      for (const listener of process.listeners("SIGINT")) {
        if (!before.int.includes(listener)) process.off("SIGINT", listener);
      }
      for (const listener of process.listeners("SIGTERM")) {
        if (!before.term.includes(listener)) process.off("SIGTERM", listener);
      }
      log.mockRestore();
      error.mockRestore();
    }
  });
});
