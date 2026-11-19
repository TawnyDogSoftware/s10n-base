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
  const fromFile = parseEnv(readFileSync(path.join(rootDir, source), "utf8"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(fromFile)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined) env[key] = value;
  }
  return { source, env };
}
