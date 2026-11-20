import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  imageContentProblems,
  LIST_FILES_SCRIPT,
  listFilesScript,
  REQUIRED_FILES,
  runtimePackages,
} from "./image-contents";

const good = [
  "/app/apps",
  "/app/apps/server",
  "/app/apps/server/dist",
  ...REQUIRED_FILES,
  "/app/apps/web/dist/assets/index-abc.js",
  "/app/node_modules/.bun",
  "/app/node_modules/.bun/pg@8.23.1",
  "/app/node_modules/.bun/pg@8.23.1/node_modules/pg/package.json",
  "/app/node_modules/.bun/@better-auth+expo@1.7.25+8d4e",
  "/app/apps/server/node_modules/pg",
];

describe("imageContentProblems", () => {
  it("accepts the entries and the web app with run-time packages only", () => {
    expect(imageContentProblems(good)).toEqual([]);
  });

  it("names each required file that is missing", () => {
    expect(imageContentProblems(good.filter((file) => !file.endsWith("migrate.mjs")))).toEqual([
      "/app/apps/server/dist/migrate.mjs is missing",
    ]);
  });

  it.each([
    ["/app/.env", "an environment file"],
    ["/app/apps/server/.env.production", "an environment file"],
    ["/app/apps/server/dist/bin.test.mjs", "a test"],
    ["/app/node_modules/.bun/x@1/node_modules/x/a.spec.js", "a test"],
    ["/app/apps/mobile", "the mobile app"],
    ["/app/apps/mobile/app.config.ts", "the mobile app"],
    ["/app/plans", "plans or docs"],
    ["/app/docs/setup.md", "plans or docs"],
    ["/app/apps/server/src", "the server's source"],
    ["/app/apps/server/src/server.ts", "TypeScript source"],
    ["/app/apps/web/dist/types.d.ts", "TypeScript source"],
    ["/usr/local/bin/npm", "a package manager"],
    ["/usr/local/lib/node_modules", "a package manager"],
  ])("refuses %s: %s", (file, problem) => {
    expect(imageContentProblems([...good, file])).toEqual([`${file}: ${problem}`]);
  });

  it("refuses development packages in the store, naming the tool", () => {
    expect(
      imageContentProblems([
        ...good,
        "/app/node_modules/.bun/vitest@5.1.0+86eb",
        "/app/node_modules/.bun/eslint@10.15.0",
        "/app/node_modules/.bun/tsdown@0.23.7",
        "/app/node_modules/.bun/vite-node@1.0.0",
      ]),
    ).toEqual([
      "eslint@10.15.0: a development package (eslint)",
      "tsdown@0.23.7: a development package (tsdown)",
      "vitest@5.1.0+86eb: a development package (vitest)",
    ]);
  });
});

describe("runtimePackages", () => {
  it("lists the store's entries, sorted", () => {
    expect(runtimePackages(good)).toEqual(["@better-auth+expo@1.7.25+8d4e", "pg@8.23.1"]);
  });
});

describe("listFilesScript", () => {
  it("lists every path under the root as JSON, without following links, and the extra paths that exist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "image-contents-"));
    mkdirSync(path.join(root, "app/apps/server/dist"), { recursive: true });
    writeFileSync(path.join(root, "app/apps/server/dist/bin.mjs"), "");
    mkdirSync(path.join(root, "outside/hidden"), { recursive: true });
    symlinkSync(path.join(root, "outside"), path.join(root, "app/linked"));
    writeFileSync(path.join(root, "npm"), "");
    const script = listFilesScript(path.join(root, "app"), [
      path.join(root, "npm"),
      path.join(root, "yarn"),
    ]);

    const listed = JSON.parse(execFileSync("node", ["-e", script]).toString()) as string[];

    expect(
      listed
        .map((file) => path.relative(root, file))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([
      "app/apps",
      "app/apps/server",
      "app/apps/server/dist",
      "app/apps/server/dist/bin.mjs",
      "app/linked",
      "npm",
    ]);
  });

  it("is what the image is listed with: /app and the package managers' paths", () => {
    expect(LIST_FILES_SCRIPT).toBe(
      listFilesScript("/app", [
        "/usr/local/bin/npm",
        "/usr/local/bin/npx",
        "/usr/local/lib/node_modules",
      ]),
    );
  });
});
