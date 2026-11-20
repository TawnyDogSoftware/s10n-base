/**
 * `bun run rename -- --name "Acme Notes" --scope @acme --slug acme-notes --bundle-id
 * com.acme.notes --scheme acmenotes [--cookie-prefix acme] [--dry-run]`: gives a project made from
 * this template its own names. It refuses a working tree with changes, and a repository already
 * renamed. It rewrites every tracked text file outside `KEPT`, runs `bun install` so bun rewrites
 * the lockfile and `bun run fmt` so the formatter re-flows what the new names' lengths changed,
 * fails if any package version moved or any spelling of the base's name is left,
 * and prints what a person still has to do. `--dry-run` lists every file and replacement and
 * writes nothing, so it also runs in a working tree with changes.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Git, processGit } from "../quality/commit-attribution";
import { parseRenameArguments } from "./arguments";
import {
  applyRules,
  BASE_NAMES,
  isKept,
  leftovers,
  lockedEntries,
  type ProjectNames,
  renameRules,
  type TextFile,
  trackedTextFiles,
  versionChanges,
} from "./rules";

/** What the rename touches: git, the files under `root`, `bun install`, and the terminal. */
export interface RenameIo {
  readonly root: string;
  readonly git: Git;
  readonly readFile: (file: string) => string;
  readonly writeFile: (file: string, text: string) => void;
  readonly listTextFiles: () => TextFile[];
  /** Runs `bun install` in `root`; returns its exit code. */
  readonly install: () => number;
  /** Runs `bun run fmt` in `root`; returns its exit code. */
  readonly format: () => number;
  readonly print: (line: string) => void;
}

/** One file the rename changes, with the new text and how many times each rule matched. */
export interface FileChange {
  readonly file: string;
  readonly text: string;
  readonly counts: ReadonlyMap<string, number>;
}

/** The change to every tracked text file outside `KEPT` that names the base. */
export function planRename(files: readonly TextFile[], names: ProjectNames): FileChange[] {
  const rules = renameRules(names);
  return files
    .filter((entry) => !isKept(entry.file))
    .flatMap((entry) => {
      const { text, counts } = applyRules(entry.text, rules);
      return text === entry.text ? [] : [{ file: entry.file, text, counts }];
    });
}

/** `file: rule ×n, rule ×n`. */
export function describeChange(change: FileChange): string {
  const parts = [...change.counts].map(([rule, count]) => `${rule} ×${String(count)}`);
  return `${change.file}: ${parts.join(", ")}`;
}

/** What a person still has to do after the rename (docs/new-project.md has the detail). */
export const NEXT_STEPS: readonly string[] = [
  "Review the change with git diff, run bun run agent:check, and commit it.",
  "Rewrite README.md for your project. Delete or keep the base's plans/, docs/adr/ and CHANGELOG.md entries; start your own plans at 001.",
  "Install the dependency-update GitHub App on the new repository and add DEPS_UPDATE_APP_CLIENT_ID and DEPS_UPDATE_APP_PRIVATE_KEY (docs/dependencies.md).",
  "Confirm the bundle identifiers and URL schemes in packages/shared/src/app-variants.ts before the first store build; they cannot change after it.",
  "Create the EAS project when you need cloud builds, and set EAS_PROJECT_ID (docs/mobile-dev.md).",
  "Sign up, then make yourself the first admin: bun run auth:set-role you@example.com admin.",
  "Deploy with docs/deployment.md.",
];

/** Why the rename must not run here, or undefined when it may. A dry run writes nothing. */
function refusal(io: RenameIo, dryRun: boolean): string | undefined {
  if (!dryRun && io.git(["status", "--porcelain"]).trim() !== "") {
    return "the working tree has changes; commit or stash them first, so the rename is one reviewable diff";
  }
  const manifest = JSON.parse(io.readFile("package.json")) as { name?: unknown };
  if (manifest.name !== BASE_NAMES.slug) {
    return `this repository is already renamed: package.json is named ${JSON.stringify(manifest.name)}, not ${BASE_NAMES.slug}`;
  }
  return undefined;
}

/** Writes the changes, reinstalls, and checks the versions and leftovers. Returns the exit code. */
function applyRename(changes: readonly FileChange[], io: RenameIo): number {
  for (const change of changes) io.writeFile(change.file, change.text);
  // Read once renamed, so that a key naming a workspace package compares under its new name.
  const before = lockedEntries(io.readFile("bun.lock"));
  io.print("rename: running bun install, so bun rewrites the lockfile for the new names");
  if (io.install() !== 0) {
    io.print("rename: bun install failed; the files are renamed, the lockfile may not be");
    return 1;
  }
  // Names of another length re-flow Markdown tables, wrapped lines and sorted manifest keys.
  io.print("rename: running bun run fmt, since the new names change line lengths and sort orders");
  if (io.format() !== 0) {
    io.print("rename: bun run fmt failed; run it, then check the result");
    return 1;
  }
  const moved = versionChanges(before, lockedEntries(io.readFile("bun.lock")));
  if (moved.length > 0) {
    io.print("rename: bun install changed package versions, which a rename must not:");
    for (const line of moved) io.print(`  ${line}`);
    return 1;
  }
  const left = leftovers(io.listTextFiles());
  if (left.length > 0) {
    io.print("rename: the base's name is still in these lines:");
    for (const line of left) io.print(`  ${line}`);
    return 1;
  }
  io.print("rename: done. No package version moved, and no spelling of the base's name is left.");
  io.print("Still to do (docs/new-project.md):");
  for (const [index, step] of NEXT_STEPS.entries()) io.print(`${String(index + 1)}. ${step}`);
  return 0;
}

/** `bun run rename`. Returns the exit code: 0 done, 1 refused or failed, 2 bad arguments. */
export function rename(argv: readonly string[], io: RenameIo): number {
  const parsed = parseRenameArguments(argv);
  if (!parsed.ok) {
    for (const problem of parsed.problems) io.print(`rename: ${problem}`);
    return 2;
  }
  const { names, dryRun } = parsed.args;
  const reason = refusal(io, dryRun);
  if (reason !== undefined) {
    io.print(`rename: refusing to run: ${reason}`);
    return 1;
  }
  const changes = planRename(io.listTextFiles(), names);
  io.print(`rename: ${String(changes.length)} files change:`);
  for (const change of changes) io.print(`  ${describeChange(change)}`);
  if (dryRun) {
    io.print("rename: dry run, nothing written. bun install would then rewrite bun.lock.");
    return 0;
  }
  return applyRename(changes, io);
}

/** The real repository at `root`. */
export function processRenameIo(
  root: string,
  print: (line: string) => void,
  bun = "bun",
): RenameIo {
  const git = processGit(root);
  return {
    root,
    git,
    readFile: (file) => readFileSync(path.join(root, file), "utf8"),
    writeFile: (file, text) => {
      writeFileSync(path.join(root, file), text);
    },
    listTextFiles: () => trackedTextFiles(git, root),
    install: () => spawnSync(bun, ["install"], { cwd: root, stdio: "inherit" }).status ?? 1,
    format: () => spawnSync(bun, ["run", "fmt"], { cwd: root, stdio: "inherit" }).status ?? 1,
    print,
  };
}
