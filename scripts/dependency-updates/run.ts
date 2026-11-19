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
      throw new Error(
        `Unknown argument: ${String(arg)}. Usage: deps:update [--dry-run] [--from <ref>]`,
      );
    }
  }
  return { dryRun, from };
}

/**
 * The headers for a JSON request: a User-Agent, which GitHub requires, and the token for GitHub's
 * API when there is one, which raises its rate limit.
 */
export function requestHeaders(url: string, token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "dependency-updates-script" };
  if (url.startsWith("https://api.github.com/") && token !== undefined && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** The real `Io`: commands, files and requests from `root`, lines to `log`. */
export class ProcessIo implements Io {
  constructor(
    private readonly root: string,
    private readonly token: string | undefined,
    private readonly print: (line: string) => void,
  ) {}

  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string; readonly input?: string },
  ): Promise<CommandResult> {
    this.print(`$ ${[command, ...args].join(" ")}`);
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
      child.on("close", (code) => {
        // No code means a signal ended it: a failure all the same.
        resolve({ code: code ?? 1, stdout, stderr });
      });
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
    const response = await fetch(url, {
      headers: requestHeaders(url, this.token),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GET ${url} answered ${String(response.status)}`);
    return response.json() as Promise<unknown>;
  }

  log(line: string): void {
    this.print(line);
  }
}

/** What `deps:update` reads and where it reports; the flow is a parameter for tests. */
export interface UpdateCommandIo {
  readonly repoRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly flow?: typeof runDependencyUpdate;
}

async function git(io: Io, args: readonly string[]): Promise<void> {
  const result = await io.run("git", args);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
}

function flowOptions(args: Args, io: UpdateCommandIo): FlowOptions {
  const name = io.env.DEPS_UPDATE_GIT_NAME;
  const email = io.env.DEPS_UPDATE_GIT_EMAIL;
  if (!args.dryRun && (name === undefined || email === undefined)) {
    throw new Error("Set DEPS_UPDATE_GIT_NAME and DEPS_UPDATE_GIT_EMAIL, or pass --dry-run.");
  }
  return {
    dryRun: args.dryRun,
    baseBranch: "main",
    ...(args.from === undefined ? {} : { startRef: args.from }),
    now: io.now,
    label: "dependency-update",
    author: {
      name: name ?? "dependency-updates dry run",
      email: email ?? "dry-run@localhost.invalid",
    },
  };
}

async function update(argv: readonly string[], io: UpdateCommandIo): Promise<void> {
  const args = parseArgs(argv);
  const options = flowOptions(args, io);
  const flow = io.flow ?? runDependencyUpdate;
  const token = io.env.GH_TOKEN;

  if (!args.dryRun) {
    const outcome = await flow(new ProcessIo(io.repoRoot, token, io.log), options);
    io.log(
      outcome.kind === "unchanged" ? "No update PR needed." : `${outcome.kind}: ${outcome.url}`,
    );
    return;
  }

  const repo = new ProcessIo(io.repoRoot, token, io.log);
  const worktree = await mkdtemp(path.join(tmpdir(), "deps-update-"));
  await git(repo, ["worktree", "add", "--detach", worktree, "HEAD"]);
  try {
    const outcome = await flow(new ProcessIo(worktree, token, io.log), options);
    io.log(
      outcome.kind === "unchanged"
        ? "Dry run: no update PR needed."
        : `Dry run: would have ${outcome.kind} ${outcome.branch}.`,
    );
  } finally {
    await git(repo, ["worktree", "remove", "--force", worktree]);
    await rm(worktree, { recursive: true, force: true });
  }
}

/** `bun run deps:update [--dry-run] [--from <ref>]`. Returns the exit code. */
export async function updateCommand(argv: readonly string[], io: UpdateCommandIo): Promise<number> {
  try {
    await update(argv, io);
    return 0;
  } catch (error) {
    io.error((error as Error).message);
    return 1;
  }
}
