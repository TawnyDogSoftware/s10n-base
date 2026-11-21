import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Git } from "../quality/commit-attribution";
import { processProofIo, proofSteps, type ProofIo, renameProof, SAMPLE_NAMES } from "./proof";
import type { TextFile } from "./rules";

interface FakeOptions {
  readonly failing?: string;
  readonly fetchable?: readonly string[];
  readonly files?: TextFile[];
  readonly cloneFails?: boolean;
}

function fakeIo(options: FakeOptions = {}) {
  const lines: string[] = [];
  const gitCalls: string[] = [];
  const bunCalls: string[] = [];
  const removed: string[] = [];
  const git =
    (cwd: string): Git =>
    (args) => {
      gitCalls.push(`${cwd}: git ${args.join(" ")}`);
      if (args.includes("clone") && options.cloneFails === true) throw new Error("clone failed");
      const fetched = String(args.at(-1)).split(":")[0]?.slice(1) ?? "";
      if (args[0] === "fetch" && !(options.fetchable ?? []).includes(fetched)) {
        throw new Error("no such ref");
      }
      return "";
    };
  const io: ProofIo = {
    root: "/repo",
    makeTempDir: () => "/work/proof",
    removeDir: (dir) => removed.push(dir),
    git,
    bun: (cwd, args) => {
      bunCalls.push(`${cwd}: bun ${args.join(" ")}`);
      return options.failing !== undefined && args.includes(options.failing) ? 3 : 0;
    },
    listTextFiles: () => options.files ?? [{ file: "README.md", text: "# Acme Notes\n" }],
    print: (line) => lines.push(line),
  };
  return { io, lines, gitCalls, bunCalls, removed };
}

describe("proofSteps", () => {
  it("renames with every sample name, then installs, checks, builds and exports", () => {
    const steps = proofSteps(SAMPLE_NAMES);

    expect(steps.map((step) => step.label)).toEqual([
      "rename",
      "frozen install",
      "agent:check",
      "build",
      "mobile export",
    ]);
    expect(steps[0]?.args).toEqual([
      "scripts/rename/rename.main.ts",
      "--name",
      "Acme Notes",
      "--scope",
      "@acme",
      "--slug",
      "acme-notes",
      "--bundle-id",
      "com.acme.notes",
      "--scheme",
      "acmenotes",
      "--cookie-prefix",
      "acme",
    ]);
  });

  it("uses sample names that differ in every form, so a rule using the wrong one shows", () => {
    const values = Object.values(SAMPLE_NAMES);

    expect(new Set(values).size).toBe(values.length);
  });
});

describe("renameProof", () => {
  it("clones, fetches main, runs every step in the clone, finds nothing left, and cleans up", () => {
    const run = fakeIo({ fetchable: ["refs/remotes/origin/main"] });

    expect(renameProof([], run.io)).toBe(0);
    expect(run.gitCalls[0]).toBe(
      "/repo: git -c advice.detachedHead=false clone --quiet --no-local /repo /work/proof/repository",
    );
    expect(run.gitCalls[1]).toBe(
      "/work/proof/repository: git fetch --quiet /repo +refs/remotes/origin/main:refs/remotes/origin/main",
    );
    expect(run.bunCalls).toHaveLength(5);
    expect(run.bunCalls.every((call) => call.startsWith("/work/proof/repository: bun "))).toBe(
      true,
    );
    expect(run.lines.at(-1)).toBe("rename proof: passed.");
    expect(run.removed).toEqual(["/work/proof"]);
  });

  it("falls back to the local main branch, and goes on without one", () => {
    const local = fakeIo({ fetchable: ["refs/heads/main"] });
    expect(renameProof([], local.io)).toBe(0);
    expect(local.lines).toContain(
      "rename proof: cloned HEAD into /work/proof/repository, with refs/heads/main as origin/main.",
    );

    const none = fakeIo();
    expect(renameProof([], none.io)).toBe(0);
    expect(none.lines).toContain(
      "rename proof: no main branch to fetch; the attribution gate will say so.",
    );
  });

  it("stops at the first step that fails", () => {
    const run = fakeIo({ failing: "agent:check" });

    expect(renameProof([], run.io)).toBe(1);
    expect(run.bunCalls).toHaveLength(3);
    expect(run.lines.at(-1)).toBe("rename proof: agent:check failed (exit 3) in the renamed copy.");
    expect(run.removed).toEqual(["/work/proof"]);
  });

  it("fails when the base's name is left in the renamed copy", () => {
    const run = fakeIo({ files: [{ file: "docs/x.md", text: "S10N_BASE_PORT\n" }] });

    expect(renameProof([], run.io)).toBe(1);
    expect(run.lines.slice(-2)).toEqual([
      "rename proof: the base's name is still in these lines of the renamed copy:",
      "  docs/x.md:1: S10N_BASE_PORT",
    ]);
  });

  it("reports a clone that fails, and keeps the directory when asked", () => {
    const run = fakeIo({ cloneFails: true });

    expect(renameProof(["--keep"], run.io)).toBe(1);
    expect(run.lines).toEqual(["rename proof: clone failed", "rename proof: kept /work/proof"]);
    expect(run.removed).toEqual([]);
  });

  it("refuses unknown arguments", () => {
    const run = fakeIo();

    expect(renameProof(["--fast"], run.io)).toBe(2);
    expect(run.lines).toEqual(["rename proof: unknown arguments: --fast"]);
  });
});

describe("processProofIo", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  it("makes and removes temporary directories, and runs bun in a directory", () => {
    const io = processProofIo("/repo", () => {}, "true");
    const dir = io.makeTempDir();
    made.push(dir);
    mkdirSync(path.join(dir, "inside"));

    expect(io.bun(dir, ["install"])).toBe(0);
    expect(processProofIo("/repo", () => {}, "false").bun(dir, [])).toBe(1);
    expect(processProofIo("/repo", () => {}, path.join(dir, "missing")).bun(dir, [])).toBe(1);
    io.removeDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("lists a repository's files with git", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rename-proof-io-"));
    made.push(root);
    const io = processProofIo(root, () => {});
    io.git(root)(["init", "--quiet"]);

    expect(io.listTextFiles(root)).toEqual([]);
  });
});
