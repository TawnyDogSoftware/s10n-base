/**
 * `bun run rename:proof [--keep]`: the proof that a renamed copy still works. It clones the
 * committed `HEAD` into a temporary directory, renames the clone with sample names, and there
 * runs a frozen install, `agent:check`, the build and the mobile export, then searches the clone
 * for any spelling of the base's name outside the kept files. CI runs it as its own job; a rename
 * that leaves the repository broken is what the rename script exists to prevent.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type Git, processGit } from "../quality/commit-attribution";
import { leftovers, type ProjectNames, type TextFile, trackedTextFiles } from "./rules";

/** The sample names. Each form differs from the others, so a rule that used the wrong one shows. */
export const SAMPLE_NAMES: ProjectNames = {
  name: "Acme Notes",
  scope: "@acme",
  slug: "acme-notes",
  bundleId: "com.acme.notes",
  scheme: "acmenotes",
  cookiePrefix: "acme",
};

/** One command the proof runs in the renamed clone. */
export interface ProofStep {
  readonly label: string;
  readonly args: readonly string[];
}

/** The commands, in order: each needs the ones before it to have passed. */
export function proofSteps(names: ProjectNames): ProofStep[] {
  return [
    {
      label: "rename",
      args: [
        "scripts/rename/rename.main.ts",
        "--name",
        names.name,
        "--scope",
        names.scope,
        "--slug",
        names.slug,
        "--bundle-id",
        names.bundleId,
        "--scheme",
        names.scheme,
        "--cookie-prefix",
        names.cookiePrefix,
      ],
    },
    { label: "frozen install", args: ["install", "--frozen-lockfile"] },
    { label: "agent:check", args: ["run", "agent:check"] },
    { label: "build", args: ["run", "build"] },
    { label: "mobile export", args: ["run", "mobile:export"] },
  ];
}

/** What the proof touches: a temporary directory, git, bun, and the terminal. */
export interface ProofIo {
  readonly root: string;
  readonly makeTempDir: () => string;
  readonly removeDir: (dir: string) => void;
  /** git in `cwd`. */
  readonly git: (cwd: string) => Git;
  /** Runs `bun <args>` in `cwd` with this terminal's output; returns the exit code. */
  readonly bun: (cwd: string, args: readonly string[]) => number;
  readonly listTextFiles: (cwd: string) => TextFile[];
  readonly print: (line: string) => void;
}

/**
 * Gives the clone the default branch the attribution gate compares with: a clone of a checkout
 * has the checkout's branches, not its remote ones, and CI's checkout has no local `main`.
 */
function fetchDefaultBranch(git: Git, root: string): string | undefined {
  for (const ref of ["refs/remotes/origin/main", "refs/heads/main"]) {
    try {
      git(["fetch", "--quiet", root, `+${ref}:refs/remotes/origin/main`]);
      return ref;
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

function runSteps(copy: string, io: ProofIo): boolean {
  for (const step of proofSteps(SAMPLE_NAMES)) {
    io.print(`rename proof: ${step.label}: bun ${step.args.join(" ")}`);
    const code = io.bun(copy, step.args);
    if (code !== 0) {
      io.print(`rename proof: ${step.label} failed (exit ${String(code)}) in the renamed copy.`);
      return false;
    }
    io.print(`rename proof: ${step.label} passed.`);
  }
  return true;
}

function proveIn(dir: string, io: ProofIo): number {
  const copy = path.join(dir, "repository");
  io.git(io.root)([
    "-c",
    "advice.detachedHead=false",
    "clone",
    "--quiet",
    "--no-local",
    io.root,
    copy,
  ]);
  const branch = fetchDefaultBranch(io.git(copy), io.root);
  io.print(
    branch === undefined
      ? "rename proof: no main branch to fetch; the attribution gate will say so."
      : `rename proof: cloned HEAD into ${copy}, with ${branch} as origin/main.`,
  );
  if (!runSteps(copy, io)) return 1;
  const left = leftovers(io.listTextFiles(copy));
  if (left.length > 0) {
    io.print("rename proof: the base's name is still in these lines of the renamed copy:");
    for (const line of left) io.print(`  ${line}`);
    return 1;
  }
  io.print("rename proof: leftover search found nothing outside the kept files.");
  io.print("rename proof: passed.");
  return 0;
}

/** `bun run rename:proof [--keep]`. Returns the exit code. */
export function renameProof(argv: readonly string[], io: ProofIo): number {
  if (argv.some((arg) => arg !== "--keep")) {
    io.print(`rename proof: unknown arguments: ${argv.join(" ")}`);
    return 2;
  }
  const dir = io.makeTempDir();
  try {
    return proveIn(dir, io);
  } catch (error) {
    io.print(`rename proof: ${(error as Error).message}`);
    return 1;
  } finally {
    if (argv.includes("--keep")) io.print(`rename proof: kept ${dir}`);
    else io.removeDir(dir);
  }
}

/** The real repository at `root`, with clones under the system's temporary directory. */
export function processProofIo(root: string, print: (line: string) => void, bun = "bun"): ProofIo {
  return {
    root,
    makeTempDir: () => mkdtempSync(path.join(tmpdir(), "rename-proof-")),
    removeDir: (dir) => {
      rmSync(dir, { recursive: true, force: true });
    },
    git: (cwd) => processGit(cwd),
    bun: (cwd, args) => spawnSync(bun, args, { cwd, stdio: "inherit" }).status ?? 1,
    listTextFiles: (cwd) => trackedTextFiles(processGit(cwd), cwd),
    print,
  };
}
