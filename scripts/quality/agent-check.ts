/**
 * `bun run agent:check`: every gate CI runs that needs no database and no browser, in order,
 * stopping at the first that fails and naming it. CI's first job runs this itself.
 */
import { spawnSync } from "node:child_process";

/** Each gate is a package.json script, run with `bun run`. */
export const GATES = [
  "lint:directives",
  "lint:oxlint",
  "lint:eslint",
  "fmt:check",
  "typecheck",
  "boundaries",
  "deadcode",
  "coverage:exclusions",
  "test:coverage",
  "deps:audit",
] as const;

/** Runs one package script and returns its exit code. */
export type RunScript = (script: string) => number;

/** Runs `bun run <script>` with this terminal's output. */
export function runScript(script: string, bun = "bun"): number {
  return spawnSync(bun, ["run", script], { stdio: "inherit" }).status ?? 1;
}

/** Runs `gates` in order until one fails. Returns the exit code. */
export function agentCheck(
  gates: readonly string[],
  run: RunScript,
  print: (line: string) => void,
): number {
  for (const [index, gate] of gates.entries()) {
    print(`agent:check ${String(index + 1)}/${String(gates.length)}: ${gate}`);
    const code = run(gate);
    if (code !== 0) {
      print(`agent:check failed at ${gate} (exit ${String(code)}). Fix that, then run it again.`);
      return code;
    }
  }
  print(`agent:check passed: ${gates.join(", ")}.`);
  return 0;
}
