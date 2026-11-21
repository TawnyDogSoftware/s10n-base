import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { loadLocalEnv, runWithEnv } from "./local-env";

const dirs: string[] = [];

function workspace(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "local-env-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadLocalEnv", () => {
  it("uses .env.example when there is no .env", () => {
    const dir = workspace({ ".env.example": "A=example\nB=example\n" });

    expect(loadLocalEnv(dir, {})).toEqual({
      source: ".env.example",
      env: { A: "example", B: "example" },
    });
  });

  it("uses .env, and only .env, when it exists", () => {
    const dir = workspace({ ".env.example": "A=example\nB=example\n", ".env": "A=mine\n" });

    expect(loadLocalEnv(dir, {})).toEqual({ source: ".env", env: { A: "mine" } });
  });

  it("lets the shell's variables win", () => {
    const dir = workspace({ ".env.example": "A=example\nB=example\n" });

    expect(loadLocalEnv(dir, { A: "shell", C: "shell", D: undefined }).env).toEqual({
      A: "shell",
      B: "example",
      C: "shell",
    });
  });
});

describe(".env.example", () => {
  const root = path.resolve(import.meta.dirname, "..");
  // Read the file itself: loadLocalEnv would prefer a developer's .env.
  const example = parseEnv(readFileSync(path.join(root, ".env.example"), "utf8"));
  // The variables the server reads (apps/server/src/config) plus the live tests' database.
  const variables = [
    "NODE_ENV",
    "APP_URL",
    "HOST",
    "PORT",
    "DATABASE_URL",
    "DATABASE_POOL_MAX",
    "TRUSTED_PROXY_HOPS",
    "REQUEST_BODY_LIMIT_BYTES",
    "SHUTDOWN_TIMEOUT_MS",
    "LOG_LEVEL",
    "BETTER_AUTH_SECRET",
    "APP_VARIANT",
    "EMAIL_FROM",
    "SUPPORT_EMAIL",
    "SES_REGION",
    "SES_ENDPOINT",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "TEST_DATABASE_URL",
  ];
  // Optional variables with no development value: listed, commented out.
  const optional = [
    "AWS_SESSION_TOKEN",
    "APP_VERSION",
    "MIGRATION_DATABASE_URL",
    "DATABASE_APP_ROLE",
  ];

  it("lists every variable", () => {
    expect(Object.keys(example).toSorted((left, right) => left.localeCompare(right))).toEqual(
      [...variables].toSorted((left, right) => left.localeCompare(right)),
    );
    const text = readFileSync(path.join(root, ".env.example"), "utf8");
    for (const name of optional) expect(text).toContain(`\n# ${name}=\n`);
  });

  it("is passed through by turbo, which hides unlisted variables from tasks", () => {
    const turbo = JSON.parse(readFileSync(path.join(root, "turbo.json"), "utf8")) as {
      globalEnv: string[];
    };

    expect(turbo.globalEnv).toEqual(expect.arrayContaining([...variables, ...optional]));
  });
});

describe("runWithEnv", () => {
  it("runs the command with the file's variables and resolves with its exit code", async () => {
    const dir = workspace({ ".env.example": "EXIT_WITH=7\n" });

    const code = await runWithEnv(
      ["node", "-e", "process.exit(Number(process.env.EXIT_WITH))"],
      dir,
      { PATH: process.env.PATH },
      () => {},
    );

    expect(code).toBe(7);
  });

  it("passes SIGTERM on to the command, and resolves with 128 when a signal ended it", async () => {
    const dir = workspace({ ".env.example": "" });
    const listeners = process.listenerCount("SIGTERM");
    const running = runWithEnv(
      ["node", "-e", "setInterval(() => {}, 1000)"],
      dir,
      { PATH: process.env.PATH },
      () => {},
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    process.emit("SIGTERM");

    expect(await running).toBe(128);
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
  });

  it("prints the usage and resolves with 2 without a command", async () => {
    const lines: string[] = [];

    expect(await runWithEnv([], workspace({}), {}, (line) => lines.push(line))).toBe(2);
    expect(lines).toEqual(["Usage: bun scripts/with-env.main.ts <command> [args...]"]);
  });
});
