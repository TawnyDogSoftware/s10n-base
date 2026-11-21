/**
 * Proves each rule in .dependency-cruiser.cjs can fire: the cruiser runs over small fixture trees
 * that break one rule each, and over the same trees without the break.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  cruise,
  type ICruiseOptions,
  type ICruiseResult,
  type IForbiddenRuleType,
} from "dependency-cruiser";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs") as {
  forbidden: IForbiddenRuleType[];
  options: ICruiseOptions;
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes the files into a new directory; each value is the file's source. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "boundaries-"));
  roots.push(root);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
  return root;
}

/** The names of the rules the files break, sorted. */
async function violations(files: Record<string, string>): Promise<string[]> {
  const root = tree(files);
  const tops = [...new Set(Object.keys(files).map((file) => file.split("/")[0] ?? ""))];
  const result = await cruise(tops, {
    // The config's own options, so what it leaves out of the graph is left out here too.
    ...config.options,
    baseDir: root,
    ruleSet: { forbidden: config.forbidden },
    validate: true,
  });
  const output = result.output as ICruiseResult;
  return output.summary.violations
    .map((violation) => violation.rule.name)
    .toSorted((left, right) => left.localeCompare(right));
}

/** A module that imports `target` (a path relative to the repo root) from `from`. */
function importing(from: string, target: string, typeOnly = false): Record<string, string> {
  const relative = path.relative(path.dirname(from), target).replace(/\.ts$/, "");
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  const statement = typeOnly
    ? `import type { Thing } from "${specifier}";\nexport type Local = Thing;\n`
    : `import { thing } from "${specifier}";\nexport const local = thing;\n`;
  return {
    [from]: statement,
    [target]: "export const thing = 1;\nexport type Thing = number;\n",
  };
}

describe("the boundary rules", () => {
  it.each<[string, string, string]>([
    ["apps-never-import-each-other", "apps/web/src/a.ts", "apps/server/src/b.ts"],
    ["apps-never-import-each-other", "apps/mobile/src/a.ts", "apps/web/src/b.ts"],
    ["packages-never-import-apps", "packages/client/src/a.ts", "apps/web/src/b.ts"],
    ["clients-use-client-packages", "apps/web/src/a.ts", "packages/extra/src/b.ts"],
    ["clients-use-client-packages", "apps/mobile/src/a.ts", "packages/extra/src/b.ts"],
    ["server-uses-server-packages", "apps/server/src/a.ts", "packages/client/src/b.ts"],
    ["server-uses-server-packages", "apps/server/src/a.ts", "packages/theme/src/b.ts"],
    ["client-package-imports", "packages/client/src/a.ts", "packages/theme/src/b.ts"],
    ["leaf-packages-import-no-package", "packages/contracts/src/a.ts", "packages/shared/src/b.ts"],
    ["leaf-packages-import-no-package", "packages/shared/src/a.ts", "packages/contracts/src/b.ts"],
    ["leaf-packages-import-no-package", "packages/theme/src/a.ts", "packages/i18n/src/b.ts"],
    ["i18n-imports-no-package", "packages/i18n/src/a.ts", "packages/contracts/src/b.ts"],
    ["i18n-tests-import-contracts-only", "packages/i18n/src/a.test.ts", "packages/shared/src/b.ts"],
    ["no-build-output", "packages/client/src/a.ts", "packages/client/dist/b.ts"],
  ])("%s fires for %s importing %s", async (rule, from, target) => {
    expect(await violations(importing(from, target))).toEqual([rule]);
  });

  it("counts a type-only import", async () => {
    expect(await violations(importing("apps/web/src/a.ts", "apps/server/src/b.ts", true))).toEqual([
      "apps-never-import-each-other",
    ]);
  });

  it("fires no-unresolvable for an import that resolves to nothing", async () => {
    // A workspace package the importer does not declare resolves to nothing: bun links each
    // workspace's own dependencies only. Without this rule, the package rules could not see it.
    const found = await violations({
      "apps/server/src/a.ts":
        'import { thing } from "@s10n-base/client";\nexport const a = thing;\n',
    });

    expect(found).toEqual(["no-unresolvable"]);
  });

  it("fires no-circular for two modules that import each other", async () => {
    const found = await violations({
      "packages/shared/src/a.ts": 'import { b } from "./b";\nexport const a = () => b;\n',
      "packages/shared/src/b.ts": 'import { a } from "./a";\nexport const b = () => a;\n',
    });

    expect(found).toEqual(["no-circular"]);
  });

  it.each<[string, string]>([
    ["apps/web/src/a.ts", "packages/client/src/b.ts"],
    ["apps/mobile/src/a.ts", "packages/theme/src/b.ts"],
    ["apps/server/src/a.ts", "packages/i18n/src/b.ts"],
    ["packages/client/src/a.ts", "packages/i18n/src/b.ts"],
    ["packages/i18n/src/a.test.ts", "packages/contracts/src/b.ts"],
    ["apps/web/src/a.ts", "apps/web/src/b.ts"],
  ])("allows %s importing %s", async (from, target) => {
    expect(await violations(importing(from, target))).toEqual([]);
  });
});
