/**
 * Entry point of the daily dependency update: `bun run deps:update [--dry-run] [--from <ref>]`.
 *
 * Without --dry-run it works in the current checkout, pushes a branch and opens or
 * updates the PR (the workflow runs it this way). With --dry-run it works in a temporary
 * git worktree, so your checkout is untouched, and prints the PR body and the push and
 * `gh` commands it would have run. --from starts from a ref instead of origin/main, for
 * a dry run of a branch; it uses committed files only.
 */
import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runDependencyUpdate, type CommandResult, type FlowOptions, type Io } from "./flow";

interface Args {
  readonly dryRun: boolean;
  readonly from: string | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  let dryRun = false;
  let from: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--from") {
      from = argv[index + 1];
      index += 1;
      if (from === undefined || from.startsWith("--")) throw new Error("--from needs a git ref");
    } else {
      throw new Error(`Unknown argument: ${arg}. Usage: deps:update [--dry-run] [--from <ref>]`);
    }
  }
  return { dryRun, from };
}

class ProcessIo implements Io {
  constructor(private readonly root: string) {}

  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string; readonly input?: string },
  ): Promise<CommandResult> {
    console.log(`$ ${[command, ...args].join(" ")}`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: path.join(this.root, options?.cwd ?? ""),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.end(options?.input ?? "");
    });
  }

  readFile(file: string): Promise<string> {
    return readFile(path.join(this.root, file), "utf8");
  }

  writeFile(file: string, text: string): Promise<void> {
    return writeFile(path.join(this.root, file), text);
  }

  async exists(file: string): Promise<boolean> {
    try {
      await access(path.join(this.root, file));
      return true;
    } catch {
      return false;
    }
  }

  /** Supports the workspace form `<dir>/*\/<file>` and plain paths. */
  async glob(pattern: string): Promise<string[]> {
    const match = /^(.*)\/\*\/([^*]+)$/.exec(pattern);
    if (match === null) return (await this.exists(pattern)) ? [pattern] : [];
    const [, dir = "", file = ""] = match;
    let entries: string[];
    try {
      entries = (await readdir(path.join(this.root, dir), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    const candidates = entries.map((name) => `${dir}/${name}/${file}`);
    const present = await Promise.all(candidates.map((candidate) => this.exists(candidate)));
    return candidates.filter((_, index) => present[index]);
  }

  async fetchJson(url: string): Promise<unknown> {
    const headers: Record<string, string> = { "User-Agent": "dependency-updates-script" };
    const token = process.env.GH_TOKEN;
    if (url.startsWith("https://api.github.com/") && token !== undefined && token !== "") {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  log(line: string): void {
    console.log(line);
  }
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const result = await new ProcessIo(cwd).run("git", args);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const name = process.env.DEPS_UPDATE_GIT_NAME;
  const email = process.env.DEPS_UPDATE_GIT_EMAIL;
  if (!args.dryRun && (name === undefined || email === undefined)) {
    throw new Error("Set DEPS_UPDATE_GIT_NAME and DEPS_UPDATE_GIT_EMAIL, or pass --dry-run.");
  }
  const options: FlowOptions = {
    dryRun: args.dryRun,
    baseBranch: "main",
    ...(args.from === undefined ? {} : { startRef: args.from }),
    now: new Date(),
    label: "dependency-update",
    author: {
      name: name ?? "dependency-updates dry run",
      email: email ?? "dry-run@localhost.invalid",
    },
  };

  if (!args.dryRun) {
    const outcome = await runDependencyUpdate(new ProcessIo(repoRoot), options);
    console.log(
      outcome.kind === "unchanged" ? "No update PR needed." : `${outcome.kind}: ${outcome.url}`,
    );
    return;
  }

  const worktree = await mkdtemp(path.join(tmpdir(), "deps-update-"));
  await git(repoRoot, ["worktree", "add", "--detach", worktree, "HEAD"]);
  try {
    const outcome = await runDependencyUpdate(new ProcessIo(worktree), options);
    console.log(
      outcome.kind === "unchanged"
        ? "Dry run: no update PR needed."
        : `Dry run: would have ${outcome.kind} ${outcome.branch}.`,
    );
  } finally {
    await git(repoRoot, ["worktree", "remove", "--force", worktree]);
    await rm(worktree, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
