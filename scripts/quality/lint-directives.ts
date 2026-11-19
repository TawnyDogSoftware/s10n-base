/**
 * The no-suppression gate (`bun run lint:directives`). Nothing in first-party source may switch a
 * lint rule off, silence the type checker, or hide code from the coverage report. The one
 * exception is TypeScript's expect-error directive in a type-level test (a file named
 * `*.types.test.ts` or `*.types.test.tsx`), where an error is the thing being tested.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { SOURCE_EXTENSIONS, commentLines, parseSource } from "./source-comments";

export interface DirectiveFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly directive: string;
}

// ESLint, oxlint and TypeScript only read a directive at the start of a comment.
const AT_START = [
  /^(?<directive>(?:eslint|oxlint)(?:-[a-z]+)*)(?=[\s:*]|$)/,
  /^(?<directive>@ts-(?:ignore|nocheck|expect-error))\b/,
];
// Coverage tools accept their hints with other text around them, so these match anywhere.
const ANYWHERE = [/\b(v8|c8|istanbul)\s+(ignore)\b/, /\b(node:coverage)\s+(ignore|disable)\b/];
const EXPECT_ERROR = "@ts-expect-error";

export function isTypeTestFile(file: string): boolean {
  return /\.types\.test\.tsx?$/.test(file);
}

function directiveIn(text: string): { directive: string; index: number } | undefined {
  for (const pattern of AT_START) {
    const match = pattern.exec(text);
    if (match?.groups?.directive !== undefined)
      return { directive: match.groups.directive, index: 0 };
  }
  for (const pattern of ANYWHERE) {
    const match = pattern.exec(text);
    if (match !== null) return { directive: match.slice(1).join(" "), index: match.index };
  }
  return undefined;
}

/** The suppression directives in one file's comments. */
export function findDirectives(file: string, text: string): DirectiveFinding[] {
  const findings: DirectiveFinding[] = [];
  for (const comment of commentLines(parseSource(file, text))) {
    const found = directiveIn(comment.text);
    if (found === undefined) continue;
    if (found.directive === EXPECT_ERROR && isTypeTestFile(file)) continue;
    findings.push({
      file,
      line: comment.line,
      column: comment.column + found.index,
      directive: found.directive,
    });
  }
  return findings;
}

/**
 * The source files git would track under `root`, committed or not: generated output, which the
 * ignore files leave out, is never read.
 */
export function listSourceFiles(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => existsSync(path.join(root, file)))
    .toSorted((left, right) => left.localeCompare(right));
}

/** Runs the gate over `root` and returns the exit code. */
export function runLintDirectiveCheck(root: string, print: (line: string) => void): number {
  const files = listSourceFiles(root);
  const findings = files.flatMap((file) =>
    findDirectives(file, readFileSync(path.join(root, file), "utf8")),
  );
  if (findings.length > 0) {
    for (const finding of findings) {
      print(
        `${finding.file}:${String(finding.line)}:${String(finding.column)} ${finding.directive}`,
      );
    }
    const count =
      findings.length === 1 ? "1 suppression" : `${String(findings.length)} suppressions`;
    print(`${count} found. Fix the code or the test instead; see docs/quality.md.`);
    return 1;
  }
  print(`No lint, type or coverage suppression in ${String(files.length)} files.`);
  const typeTests = files.filter(isTypeTestFile);
  print(`Type-level tests, where expect-error is allowed: ${typeTests.join(", ") || "none"}`);
  return 0;
}
