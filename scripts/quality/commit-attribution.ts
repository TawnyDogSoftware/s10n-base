/**
 * The commit-attribution gate (`bun run commits:attribution`). Commit messages, and a pull
 * request's title and description, say what changed and why; they never credit the tool that
 * helped write the change. This fails on an attribution trailer that names an AI tool, on an AI
 * vendor's no-reply address, and on a "generated with" footer, and says which commit and line.
 *
 * It checks the commits a branch proposes: from the merge base with the default branch to `HEAD`.
 * In CI it also checks the pull request's title and description, from `PR_TITLE` and `PR_BODY`.
 * `.githooks/commit-msg` runs it on one message (`--message-file <path>`) before the commit exists.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** One rule: a line matching `pattern` fails. `example` is a line it must catch (tested). */
export interface AttributionRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly example: string;
}

/** AI coding tools and their vendors, as they appear in trailers and footers. */
const TOOLS = [
  String.raw`claude[\s-]+(?:code|opus|sonnet|haiku|fable|\d)`,
  "anthropic",
  "openai",
  "chatgpt",
  String.raw`gpt-\d`,
  "codex",
  "copilot",
  "gemini",
  "cursor",
  "devin",
  "aider",
  "windsurf",
  "codeium",
  "tabnine",
  "codewhisperer",
  String.raw`amazon\s+q`,
].join("|");

/** Domains whose addresses only an AI tool or its vendor's bot commits from. */
const VENDOR_ADDRESS = String.raw`@(?:anthropic\.com|openai\.com|cursor\.com|cursor\.sh|devin\.ai)\b|\bcopilot@github\.com\b|\+copilot@users\.noreply\.github\.com\b`;

/**
 * Every rule, in one list; a line is reported under the first it breaks. A person's ordinary
 * `Co-authored-by:` trailer passes, and so does prose that happens to use one of these words
 * outside a trailer ("the cursor is opaque").
 */
export const ATTRIBUTION_RULES: readonly AttributionRule[] = [
  {
    name: "an AI vendor's address",
    pattern: new RegExp(VENDOR_ADDRESS, "i"),
    example: "Co-Authored-By: Claude <noreply@anthropic.com>",
  },
  {
    name: "a trailer naming an AI tool",
    pattern: new RegExp(String.raw`^\s*[a-z][a-z-]*-by:.*\b(?:${TOOLS})\b`, "i"),
    example: "Co-authored-by: Cursor Agent <agent@example.com>",
  },
  {
    name: "a generated-with footer",
    pattern: new RegExp(
      String.raw`\bgenerated\s+(?:with|by|using|via)\b.*\b(?:${TOOLS}|ai)\b`,
      "i",
    ),
    example: "Generated with [Claude Code](https://claude.com/claude-code)",
  },
  {
    name: "a link to an AI tool's session or product page",
    pattern: /\b(?:claude\.ai\/code|claude\.com\/claude-code|chatgpt\.com\/codex)\b/i,
    example: "https://claude.ai/code/session_0123",
  },
  {
    name: "a robot-emoji footer",
    pattern: /^\s*\u{1F916}/u,
    example: "\u{1F916} Written by a bot",
  },
];

/** One message to check, and what to call it in a failure. */
export interface Message {
  readonly label: string;
  readonly text: string;
}

/** Every line of `message` that breaks a rule, as `<label> line <n>: <rule>: <line>`. */
export function attributionProblems(
  message: Message,
  rules: readonly AttributionRule[] = ATTRIBUTION_RULES,
): string[] {
  const problems: string[] = [];
  for (const [index, line] of message.text.split("\n").entries()) {
    const rule = rules.find((candidate) => candidate.pattern.test(line));
    if (rule !== undefined) {
      problems.push(`${message.label} line ${String(index + 1)}: ${rule.name}: ${line.trim()}`);
    }
  }
  return problems;
}

/** Drops the `#` comment lines git puts in a message file for the editor. */
export function stripGitComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

/** Runs git with `args` and returns its output; throws with git's error when it fails. */
export type Git = (args: readonly string[]) => string;

/** Runs the real git in `cwd`. */
export function processGit(cwd: string, git = "git"): Git {
  return (args) => {
    const result = spawnSync(git, args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout;
  };
}

/**
 * `origin/main` comes before `origin/HEAD`: a clone of a local checkout points `origin/HEAD` at
 * whatever branch that checkout had, which may be the branch under check.
 */
const DEFAULT_BRANCHES = ["origin/main", "origin/HEAD", "main"];

function resolves(git: Git, ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The default branch to compare with: `ATTRIBUTION_BASE` when set, otherwise the first of
 * `origin/main`, `origin/HEAD` and `main` that exists.
 *
 * @throws {Error} when none exists.
 */
export function baseRef(git: Git, env: Readonly<Record<string, string | undefined>>): string {
  const wanted = env.ATTRIBUTION_BASE?.trim();
  const candidates = wanted === undefined || wanted === "" ? DEFAULT_BRANCHES : [wanted];
  const found = candidates.find((ref) => resolves(git, ref));
  if (found === undefined) {
    throw new Error(
      `cannot find the default branch (tried ${candidates.join(", ")}); fetch it, or set ATTRIBUTION_BASE`,
    );
  }
  return found;
}

const RECORD = "\u001E";
const FIELD = "\u001F";

/** The messages of the commits from the merge base of `base` and `HEAD` to `HEAD`. */
export function proposedCommits(git: Git, base: string): Message[] {
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const log = git(["log", `--format=%h${FIELD}%B${RECORD}`, `${mergeBase}..HEAD`]);
  return log
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.includes(FIELD))
    .map((record) => {
      const [sha = "", text = ""] = record.split(FIELD);
      return { label: `commit ${sha}`, text };
    });
}

/** The pull request's title and description, when CI passes them. */
export function pullRequestMessages(env: Readonly<Record<string, string | undefined>>): Message[] {
  const messages: Message[] = [];
  if (env.PR_TITLE !== undefined) {
    messages.push({ label: "pull request title", text: env.PR_TITLE });
  }
  if (env.PR_BODY !== undefined) {
    messages.push({ label: "pull request description", text: env.PR_BODY });
  }
  return messages;
}

export interface AttributionIo {
  readonly git: Git;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (file: string) => string;
  readonly print: (line: string) => void;
}

function messagesToCheck(argv: readonly string[], io: AttributionIo): Message[] {
  if (argv[0] === "--message-file") {
    const file = argv[1];
    if (file === undefined) throw new Error("--message-file needs the path of the message");
    return [{ label: "this commit message", text: stripGitComments(io.readFile(file)) }];
  }
  if (argv.length > 0) throw new Error(`unknown arguments: ${argv.join(" ")}`);
  return [...proposedCommits(io.git, baseRef(io.git, io.env)), ...pullRequestMessages(io.env)];
}

/**
 * `bun run commits:attribution [--message-file <path>]`. Returns the exit code: 0 when nothing
 * credits an AI tool, 1 when something does, 2 when the check could not run.
 */
export function commitAttribution(argv: readonly string[], io: AttributionIo): number {
  let messages: Message[];
  try {
    messages = messagesToCheck(argv, io);
  } catch (error) {
    io.print(`commit attribution: ${(error as Error).message}`);
    return 2;
  }
  const problems = messages.flatMap((message) => attributionProblems(message));
  if (problems.length === 0) {
    io.print(`commit attribution: ${String(messages.length)} checked, none credits an AI tool.`);
    return 0;
  }
  for (const problem of problems) io.print(problem);
  io.print(
    "commit attribution: remove these lines. Commit messages and pull requests say what changed and why, not which tool helped (AGENTS.md).",
  );
  return 1;
}

/** The real files, git in `root` and this process's environment. */
export function processIo(root: string, print: (line: string) => void): AttributionIo {
  return {
    git: processGit(root),
    env: process.env,
    readFile: (file) => readFileSync(file, "utf8"),
    print,
  };
}
