import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export interface LocalEnv {
  /** The file the defaults came from: `.env`, or `.env.example` when there is no `.env`. */
  readonly source: ".env" | ".env.example";
  readonly env: Record<string, string>;
}

/**
 * The environment for local commands: `.env` if it exists, otherwise `.env.example`, with any
 * variable already set in `current` (the shell) taking precedence.
 */
export function loadLocalEnv(
  rootDir: string,
  current: Readonly<Record<string, string | undefined>>,
): LocalEnv {
  const dotEnv = path.join(rootDir, ".env");
  const source = existsSync(dotEnv) ? ".env" : ".env.example";
  // parseEnv returns only strings; its type allows undefined like every NodeJS.Dict.
  const env = { ...parseEnv(readFileSync(path.join(rootDir, source), "utf8")) } as Record<
    string,
    string
  >;
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined) env[key] = value;
  }
  return { source, env };
}

const FORWARDED = ["SIGINT", "SIGTERM"] as const;

/**
 * `bun scripts/with-env.main.ts <command> [args...]`: runs a command with the local environment
 * and resolves with its exit code, or 128 when a signal ended it. Ctrl-C and SIGTERM are passed
 * on to the command. Exits 2 without a command.
 */
export async function runWithEnv(
  argv: ReadonlyArray<string>,
  rootDir: string,
  current: Readonly<Record<string, string | undefined>>,
  error: (line: string) => void,
): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined) {
    error("Usage: bun scripts/with-env.main.ts <command> [args...]");
    return 2;
  }
  const { env } = loadLocalEnv(rootDir, current);
  const child = spawn(command, args, { env, stdio: "inherit" });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  for (const signal of FORWARDED) process.on(signal, forward);
  try {
    const [code] = (await once(child, "exit")) as [number | null];
    return code ?? 128;
  } finally {
    for (const signal of FORWARDED) process.off(signal, forward);
  }
}
