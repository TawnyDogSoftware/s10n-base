/**
 * The coverage exclusions, reviewed: every pattern the root vitest.config.ts leaves out of the
 * coverage report, with why and what exercises the code instead. `bun run coverage:exclusions`
 * fails when the config's list and this one differ, so an exclusion is always a deliberate change
 * to two files. It also fails when an excluded entry point holds more than wiring.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { listSourceFiles } from "./lint-directives";
import { parseSource } from "./source-comments";

type ExclusionKind = "test" | "types" | "generated" | "entry";

export interface Exclusion {
  readonly pattern: string;
  readonly kind: ExclusionKind;
  readonly reason: string;
  /** What runs this code, since the unit tests' report does not. */
  readonly exercisedBy: string;
}

export const REVIEWED_EXCLUSIONS: readonly Exclusion[] = [
  {
    pattern: "**/*.test.{ts,tsx}",
    kind: "test",
    reason: "Tests are not application code.",
    exercisedBy: "bun run test",
  },
  {
    pattern: "apps/*/src/test/**",
    kind: "test",
    reason: "Test support: fakes, render helpers and the live tests' database harness.",
    exercisedBy: "the tests that use them",
  },
  {
    pattern: "packages/client/src/test-fetch.ts",
    kind: "test",
    reason: "A fake fetch for the client package's tests.",
    exercisedBy: "packages/client's tests",
  },
  {
    pattern: "packages/client/src/testing/**",
    kind: "test",
    reason: "The fake server the client, web and mobile tests share.",
    exercisedBy: "the web and mobile tests",
  },
  {
    pattern: "**/*.d.ts",
    kind: "types",
    reason: "Type declarations hold no code that runs.",
    exercisedBy: "bun run typecheck",
  },
  {
    pattern: "apps/server/src/infra/postgres/generated/**",
    kind: "generated",
    reason: "Database types written by kysely-codegen.",
    exercisedBy: "bun run db:generate:check, in CI",
  },
  {
    pattern: "apps/mobile/src/app/**",
    kind: "entry",
    reason: "expo-router's route files, each re-exporting a screen from src/screens.",
    exercisedBy: "the screens' tests; bun run mobile:export bundles every route",
  },
  {
    pattern: "apps/server/src/bin.ts",
    kind: "entry",
    reason: "The server process: runs runServerProcess with this process and the environment.",
    exercisedBy: "bun run smoke, in CI, against the built bin.mjs",
  },
  {
    pattern: "apps/server/src/migrate.ts",
    kind: "entry",
    reason: "Passes this process's arguments and environment to runMigrateCli.",
    exercisedBy: "bun run db:migrate, in CI",
  },
  {
    pattern: "apps/server/src/set-role.ts",
    kind: "entry",
    reason: "Passes this process's arguments and environment to runSetRoleCli.",
    exercisedBy: "set-role-cli.live.test.ts",
  },
  {
    pattern: "apps/web/src/main.tsx",
    kind: "entry",
    reason: "Loads the stylesheet and mounts the app in the page.",
    exercisedBy: "bun run build and the browser journeys (bun run test:e2e)",
  },
  {
    pattern: "scripts/**/*.main.ts",
    kind: "entry",
    reason: "Script entry points: each calls one tested function with this process's state.",
    exercisedBy: "the package.json scripts and CI steps that run them",
  },
];

/** The most statements an entry point may hold besides its imports. */
const ENTRY_STATEMENT_LIMIT = 3;

const LOGIC = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
]);

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isLogic(node: ts.Node): boolean {
  if (LOGIC.has(node.kind)) return true;
  return ts.isBinaryExpression(node) && SHORT_CIRCUIT.has(node.operatorToken.kind);
}

/**
 * Why `text` is more than wiring, or undefined when it is wiring: imports, then at most
 * {@link ENTRY_STATEMENT_LIMIT} statements with no branch, loop, try or function of their own.
 * Anything more belongs in a module the tests cover.
 */
export function wiringProblem(file: string, text: string): string | undefined {
  const source = parseSource(file, text);
  const statements = source.statements.filter((statement) => !ts.isImportDeclaration(statement));
  if (statements.length > ENTRY_STATEMENT_LIMIT) {
    return `${String(statements.length)} statements besides imports; at most ${String(ENTRY_STATEMENT_LIMIT)}`;
  }
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (found === undefined && isLogic(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found === undefined) return undefined;
  const line = source.getLineAndCharacterOfPosition(found.getStart(source)).line + 1;
  return `${ts.SyntaxKind[found.kind]} at line ${String(line)}; an entry point only wires`;
}

/** Turns a coverage glob (`**`, `*`, `{a,b}`) into a regular expression over repo paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const rest = glob.slice(index);
    if (rest.startsWith("**/")) {
      pattern += "(?:.*/)?";
      index += 2;
    } else if (rest.startsWith("**")) {
      pattern += ".*";
      index += 1;
    } else {
      pattern += globCharacter(glob.charAt(index));
    }
  }
  return new RegExp(`^${pattern}$`);
}

function globCharacter(character: string): string {
  if (character === "*") return "[^/]*";
  if (character === "{") return "(?:";
  if (character === "}") return ")";
  if (character === ",") return "|";
  return character.replace(/[.+?^$()|[\]\\]/g, "\\$&");
}

/** Every problem with the config's exclusions against the reviewed list; empty when they agree. */
export function exclusionProblems(
  configured: readonly string[],
  reviewed: readonly Exclusion[],
  files: ReadonlyArray<{ readonly path: string; readonly text: string }>,
): string[] {
  const problems: string[] = [];
  const reviewedPatterns = reviewed.map((entry) => entry.pattern);
  for (const pattern of configured) {
    if (!reviewedPatterns.includes(pattern)) {
      problems.push(`vitest.config.ts excludes ${pattern}, which the reviewed list does not`);
    }
  }
  for (const pattern of reviewedPatterns) {
    if (!configured.includes(pattern)) {
      problems.push(`the reviewed list has ${pattern}, which vitest.config.ts does not exclude`);
    }
  }
  for (const entry of reviewed.filter((each) => each.kind === "entry")) {
    const matcher = globToRegExp(entry.pattern);
    for (const file of files.filter((each) => matcher.test(each.path))) {
      const problem = wiringProblem(file.path, file.text);
      if (problem !== undefined)
        problems.push(`${file.path} is excluded as wiring but has ${problem}`);
    }
  }
  return problems;
}

/** The exclude list of the root vitest config, read without running it. */
export function configuredExclusions(configText: string): string[] {
  const source = parseSource("vitest.config.ts", configText);
  const lists: string[][] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "exclude" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      lists.push(
        node.initializer.elements.map((element) =>
          ts.isStringLiteral(element) ? element.text : element.getText(source),
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lists.flat();
}

/** Runs the check over the repository at `root` and returns the exit code. */
export function runCoverageExclusionCheck(root: string, print: (line: string) => void): number {
  const configured = configuredExclusions(
    readFileSync(path.join(root, "vitest.config.ts"), "utf8"),
  );
  const files = listSourceFiles(root).map((file) => ({
    path: file,
    text: readFileSync(path.join(root, file), "utf8"),
  }));
  const problems = exclusionProblems(configured, REVIEWED_EXCLUSIONS, files);
  for (const problem of problems) print(problem);
  if (problems.length > 0) return 1;
  print(
    `Coverage leaves out ${String(REVIEWED_EXCLUSIONS.length)} reviewed patterns; every entry point is wiring.`,
  );
  return 0;
}
