import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  findDirectives,
  isTypeTestFile,
  listSourceFiles,
  runLintDirectiveCheck,
} from "./lint-directives";

// The directives are assembled from parts so this file does not contain them in its own comments
// or strings in a form a tool could read as one.
const ESLINT_OFF = ["eslint", "disable"].join("-");
const OXLINT_OFF = ["oxlint", "disable"].join("-");
const TS_IGNORE = ["@ts", "ignore"].join("-");
const TS_NOCHECK = ["@ts", "nocheck"].join("-");
const TS_EXPECT = ["@ts", "expect-error"].join("-");

describe("findDirectives", () => {
  it.each([
    [`// ${ESLINT_OFF}-next-line no-console\nconsole.log(1);`, `${ESLINT_OFF}-next-line`],
    [`/* ${ESLINT_OFF} */\nexport {};`, ESLINT_OFF],
    [`const a = 1; // ${ESLINT_OFF}-line`, `${ESLINT_OFF}-line`],
    [`/* eslint no-console: "off" */\nexport {};`, "eslint"],
    [`// ${OXLINT_OFF}-next-line no-debugger\nexport {};`, `${OXLINT_OFF}-next-line`],
    [`// ${TS_IGNORE}\nconst a: number = "x";`, TS_IGNORE],
    [`// ${TS_NOCHECK}\nexport {};`, TS_NOCHECK],
    [`/** ${TS_IGNORE} */\nexport {};`, TS_IGNORE],
    [`// ${TS_EXPECT} wrong type\nconst a: number = "x";`, TS_EXPECT],
    [`/* v8 ignore next */\nexport {};`, "v8 ignore"],
    [`/* c8 ignore next */\nexport {};`, "c8 ignore"],
    [`/* istanbul ignore else */\nexport {};`, "istanbul ignore"],
    [`/* v8 ignore start -- @preserve */\nexport {};`, "v8 ignore"],
    [`// node:coverage disable\nexport {};`, "node:coverage disable"],
  ])("finds a directive in %j", (source, directive) => {
    expect(findDirectives("file.ts", source).map((finding) => finding.directive)).toEqual([
      directive,
    ]);
  });

  it("gives the line and column of each directive", () => {
    const source = `export const a = 1;\n\nfunction f() {\n  // ${TS_IGNORE}\n  return 1;\n}\n`;

    expect(findDirectives("file.ts", source)).toEqual([
      { file: "file.ts", line: 4, column: 6, directive: TS_IGNORE },
    ]);
  });

  it("finds directives inside JSX, including after text with quotes in it", () => {
    const source = `export const A = () => (\n  <p>\n    Don't {/* ${ESLINT_OFF}-line */}\n  </p>\n);\n`;

    expect(findDirectives("file.tsx", source)).toEqual([
      { file: "file.tsx", line: 3, column: 15, directive: `${ESLINT_OFF}-line` },
    ]);
  });

  it("reads each line of a block comment", () => {
    const source = `/**\n * Notes.\n * ${TS_IGNORE}\n */\nexport {};`;

    expect(findDirectives("file.ts", source).map((finding) => finding.line)).toEqual([3]);
  });

  it("ignores directives in strings, templates and regular expressions", () => {
    const source = [
      `const a = "// ${ESLINT_OFF}";`,
      `const b = \`/* ${TS_IGNORE} */\`;`,
      `const c = /v8 ignore next/;`,
      "export { a, b, c };",
    ].join("\n");

    expect(findDirectives("file.ts", source)).toEqual([]);
  });

  it("ignores comments that only mention a directive part way through", () => {
    const source = [
      `// The ${TS_EXPECT} lines below must be errors.`,
      `/* Never use ${ESLINT_OFF} here. */`,
      "export {};",
    ].join("\n");

    expect(findDirectives("file.ts", source)).toEqual([]);
  });

  it("allows the expect-error directive in a type-level test file only", () => {
    const source = `// ${TS_EXPECT} not a key\nconst a: number = "x";\n`;

    expect(findDirectives("src/keys.types.test.ts", source)).toEqual([]);
    expect(findDirectives("src/keys.test.ts", source)).toHaveLength(1);
  });

  it("still refuses other directives in a type-level test file", () => {
    expect(findDirectives("src/keys.types.test.ts", `// ${TS_IGNORE}\nexport {};`)).toHaveLength(1);
  });
});

describe("a file of a type it does not know", () => {
  it("is read as TypeScript", () => {
    expect(findDirectives("notes.txt", `// ${TS_IGNORE}\n`)).toHaveLength(1);
  });
});

describe("isTypeTestFile", () => {
  it.each([
    ["packages/i18n/src/keys.types.test.ts", true],
    ["apps/web/src/routes.types.test.tsx", true],
    ["packages/i18n/src/keys.test.ts", false],
    ["packages/i18n/src/types.ts", false],
    ["packages/i18n/src/keys.types.ts", false],
  ])("%s: %s", (file, expected) => {
    expect(isTypeTestFile(file)).toBe(expected);
  });
});

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A throwaway git repository with the given files, some committed and some not. */
function repository(files: Record<string, string>, ignore = ""): string {
  const root = mkdtempSync(path.join(tmpdir(), "lint-directives-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  writeFileSync(path.join(root, ".gitignore"), ignore);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe("listSourceFiles", () => {
  it("lists source files git would track, committed or not, and skips ignored ones", () => {
    const root = repository(
      {
        "apps/web/src/a.tsx": "",
        "scripts/b.mjs": "",
        "eslint.config.mjs": "",
        "metro.config.cjs": "",
        "docs/notes.md": "",
        "apps/web/dist/bundle.js": "",
        "apps/mobile/.expo/types/router.d.ts": "",
      },
      "dist/\n.expo/\n",
    );

    expect(listSourceFiles(root)).toEqual([
      "apps/web/src/a.tsx",
      "eslint.config.mjs",
      "metro.config.cjs",
      "scripts/b.mjs",
    ]);
  });
});

describe("runLintDirectiveCheck", () => {
  it("passes and names the type-level test files when nothing is suppressed", () => {
    const root = repository({
      "src/a.ts": "export const a = 1;\n",
      "src/keys.types.test.ts": `// ${TS_EXPECT} not a key\nconst a: number = "x";\n`,
    });
    const lines: string[] = [];

    expect(runLintDirectiveCheck(root, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual([
      "No lint, type or coverage suppression in 2 files.",
      "Type-level tests, where expect-error is allowed: src/keys.types.test.ts",
    ]);
  });

  it("says so when there is no type-level test", () => {
    const root = repository({ "src/a.ts": "export const a = 1;\n" });
    const lines: string[] = [];

    expect(runLintDirectiveCheck(root, (line) => lines.push(line))).toBe(0);
    expect(lines.at(-1)).toBe("Type-level tests, where expect-error is allowed: none");
  });

  it("fails and lists each suppression with its place", () => {
    const root = repository({
      "src/a.ts": `// ${ESLINT_OFF}-next-line\nexport const a = 1;\n`,
      "src/b.test.ts": `// ${TS_EXPECT}\nconst b: number = "x";\n`,
    });
    const lines: string[] = [];

    expect(runLintDirectiveCheck(root, (line) => lines.push(line))).toBe(1);
    expect(lines).toEqual([
      `src/a.ts:1:4 ${ESLINT_OFF}-next-line`,
      `src/b.test.ts:1:4 ${TS_EXPECT}`,
      "2 suppressions found. Fix the code or the test instead; see docs/quality.md.",
    ]);
  });

  it("counts a single suppression in the singular", () => {
    const root = repository({ "src/a.ts": `// ${ESLINT_OFF}-next-line\nexport const a = 1;\n` });
    const lines: string[] = [];

    expect(runLintDirectiveCheck(root, (line) => lines.push(line))).toBe(1);
    expect(lines.at(-1)).toBe(
      "1 suppression found. Fix the code or the test instead; see docs/quality.md.",
    );
  });
});
