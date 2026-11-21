import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  configuredExclusions,
  type Exclusion,
  exclusionProblems,
  globToRegExp,
  REVIEWED_EXCLUSIONS,
  runCoverageExclusionCheck,
  wiringProblem,
} from "./coverage-exclusions";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("REVIEWED_EXCLUSIONS", () => {
  it("gives every exclusion a reason and what exercises it instead", () => {
    for (const entry of REVIEWED_EXCLUSIONS) {
      expect(entry.reason, entry.pattern).not.toBe("");
      expect(entry.exercisedBy, entry.pattern).not.toBe("");
    }
  });

  it("matches the root vitest config, whose entry points are all wiring", () => {
    const lines: string[] = [];

    expect(runCoverageExclusionCheck(repoRoot, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual([
      `Coverage leaves out ${String(REVIEWED_EXCLUSIONS.length)} reviewed patterns; every entry point is wiring.`,
    ]);
  });
});

describe("configuredExclusions", () => {
  it("reads the exclude list of the config", () => {
    expect(
      configuredExclusions('export default { test: { coverage: { exclude: ["a/**", b] } } };'),
    ).toEqual(["a/**", "b"]);
    expect(
      configuredExclusions(readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8")),
    ).toEqual(REVIEWED_EXCLUSIONS.map((entry) => entry.pattern));
  });
});

describe("globToRegExp", () => {
  it.each([
    ["**/*.test.{ts,tsx}", "apps/web/src/a.test.tsx", true],
    ["**/*.test.{ts,tsx}", "a.test.ts", true],
    ["**/*.test.{ts,tsx}", "apps/web/src/a.ts", false],
    ["apps/*/src/test/**", "apps/web/src/test/render.tsx", true],
    ["apps/*/src/test/**", "apps/web/src/tests/render.tsx", false],
    ["scripts/**/*.main.ts", "scripts/dev.main.ts", true],
    ["scripts/**/*.main.ts", "scripts/ses-local/run.main.ts", true],
    ["apps/server/src/bin.ts", "apps/server/src/binXts", false],
  ])("%s matches %s: %s", (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});

describe("wiringProblem", () => {
  it("accepts imports and a few plain statements", () => {
    const text =
      'import { run } from "./run";\n\nprocess.exitCode = await run(process.argv.slice(2), console);\n';

    expect(wiringProblem("x.main.ts", text)).toBeUndefined();
    expect(
      wiringProblem("route.tsx", 'export { Screen as default } from "../screens/x";\n'),
    ).toBeUndefined();
  });

  it.each([
    ["a branch", "if (process.argv.length > 2) run();", "IfStatement at line 1"],
    ["a conditional", "run(process.env.X ? 1 : 2);", "ConditionalExpression at line 1"],
    ["a default", 'run(process.argv[2] ?? "x");', "BinaryExpression at line 1"],
    ["a loop", "for (const arg of process.argv) run(arg);", "ForOfStatement at line 1"],
    ["a function", "run(() => 1);", "ArrowFunction at line 1"],
    ["a try", "try { run(); } catch {}", "TryStatement at line 1"],
  ])("refuses %s", (_case, text, problem) => {
    expect(wiringProblem("x.main.ts", text)).toContain(problem);
  });

  it("refuses more statements than wiring needs", () => {
    expect(wiringProblem("x.main.ts", "a();\nb();\nc();\nd();\n")).toBe(
      "4 statements besides imports; at most 3",
    );
  });
});

describe("exclusionProblems", () => {
  const reviewed: readonly Exclusion[] = [
    { pattern: "**/*.test.ts", kind: "test", reason: "tests", exercisedBy: "test" },
    { pattern: "src/*.main.ts", kind: "entry", reason: "entry", exercisedBy: "CI" },
  ];

  it("reports an exclusion only one of the two lists has", () => {
    expect(exclusionProblems(["**/*.test.ts", "src/legacy/**"], reviewed, [])).toEqual([
      "vitest.config.ts excludes src/legacy/**, which the reviewed list does not",
      "the reviewed list has src/*.main.ts, which vitest.config.ts does not exclude",
    ]);
  });

  it("reports an excluded entry point that holds logic", () => {
    const files = [
      { path: "src/app.main.ts", text: "if (process.env.X) start();" },
      { path: "src/other.ts", text: "if (process.env.X) start();" },
    ];

    expect(exclusionProblems(["**/*.test.ts", "src/*.main.ts"], reviewed, files)).toEqual([
      "src/app.main.ts is excluded as wiring but has IfStatement at line 1; an entry point only wires",
    ]);
  });
});

describe("runCoverageExclusionCheck", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("fails and lists the problems in a repository whose lists disagree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "coverage-exclusions-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(
      path.join(root, "vitest.config.ts"),
      'export default { test: { coverage: { exclude: ["**/*.test.{ts,tsx}"] } } };\n',
    );
    mkdirSync(path.join(root, "scripts"));
    writeFileSync(path.join(root, "scripts/x.main.ts"), "if (process.env.X) run();\n");
    const lines: string[] = [];

    expect(runCoverageExclusionCheck(root, (line) => lines.push(line))).toBe(1);
    expect(lines).toContain(
      "the reviewed list has apps/server/src/bin.ts, which vitest.config.ts does not exclude",
    );
    expect(lines).toContain(
      "scripts/x.main.ts is excluded as wiring but has IfStatement at line 1; an entry point only wires",
    );
  });
});
