import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { agentCheck, GATES, runScript } from "./agent-check";

const root = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("GATES", () => {
  it("are all package scripts", () => {
    for (const gate of GATES) expect(manifest.scripts[gate], gate).toBeDefined();
  });

  it("include everything plan 007 lists, without a database or a browser", () => {
    expect(GATES).toEqual([
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
    ]);
    expect(manifest.scripts["agent:check"]).toBe("bun scripts/quality/agent-check.main.ts");
  });
});

describe("agentCheck", () => {
  it("runs every gate in order and passes", () => {
    const ran: string[] = [];
    const lines: string[] = [];

    expect(
      agentCheck(
        ["a", "b"],
        (gate) => (ran.push(gate), 0),
        (line) => lines.push(line),
      ),
    ).toBe(0);
    expect(ran).toEqual(["a", "b"]);
    expect(lines).toEqual([
      "agent:check 1/2: a",
      "agent:check 2/2: b",
      "agent:check passed: a, b.",
    ]);
  });

  it("stops at the first failing gate, names it, and exits with its code", () => {
    const ran: string[] = [];
    const lines: string[] = [];

    const code = agentCheck(
      ["a", "b", "c"],
      (gate) => (ran.push(gate), gate === "b" ? 3 : 0),
      (line) => lines.push(line),
    );

    expect(code).toBe(3);
    expect(ran).toEqual(["a", "b"]);
    expect(lines.at(-1)).toBe("agent:check failed at b (exit 3). Fix that, then run it again.");
  });
});

describe("runScript", () => {
  it("returns the script runner's exit code", () => {
    expect(runScript("anything", "true")).toBe(0);
    expect(runScript("anything", "false")).toBe(1);
  });

  it("reports a runner that cannot start as a failure", () => {
    expect(runScript("anything", "no-such-runner-anywhere")).toBe(1);
  });
});
