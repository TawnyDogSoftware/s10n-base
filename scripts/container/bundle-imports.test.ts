import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bundleImportsCommand,
  compareImports,
  importedPackages,
  packageOf,
} from "./bundle-imports";

describe("packageOf", () => {
  it.each([
    ["kysely", "kysely"],
    ["kysely/migration", "kysely"],
    ["@better-auth/expo", "@better-auth/expo"],
    ["@better-auth/expo/client", "@better-auth/expo"],
    ["./pool-abc.mjs", undefined],
    ["../x", undefined],
    ["/abs/x.mjs", undefined],
    ["node:http", undefined],
    ["fs", undefined],
    ["fs/promises", undefined],
  ])("%s is %s", (specifier, name) => {
    expect(packageOf(specifier)).toBe(name);
  });
});

describe("importedPackages", () => {
  it("finds static, side-effect, re-export and dynamic imports of packages", () => {
    const source = [
      'import { a as b } from "./chunk-1.mjs";',
      'import http from "node:http";',
      'import { Effect, Schema } from "effect";',
      'import "reflect-metadata";',
      'export { x } from "@scope/pkg/sub";',
      "import {",
      "  multi,",
      '} from "multi-line";',
      'const lazy = () => import("lazy-pkg");',
      'const text = "import nothing";',
    ].join("\n");

    expect(importedPackages(source)).toEqual([
      "effect",
      "reflect-metadata",
      "@scope/pkg",
      "lazy-pkg",
    ]);
  });
});

describe("compareImports", () => {
  it("is empty when the two sets are equal", () => {
    expect(compareImports(new Set(["a", "b"]), new Set(["b", "a"]))).toEqual([]);
  });

  it("names a package imported but not declared, and one declared but not imported", () => {
    expect(compareImports(new Set(["a", "b"]), new Set(["a", "c"]))).toEqual([
      "The bundle imports b, which the server does not declare as a dependency, so the image would not have it.",
      "The server declares c, which the bundle never imports: remove it from dependencies, or bundle it.",
    ]);
  });
});

describe("bundleImportsCommand", () => {
  let dir: string;
  const lines: string[] = [];
  const errors: string[] = [];
  const io = {
    log: (line: string) => lines.push(line),
    error: (line: string) => errors.push(line),
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bundle-imports-"));
    await mkdir(path.join(dir, "dist"));
    await writeFile(
      path.join(dir, "dist/bin.mjs"),
      'import { Effect } from "effect";\nimport "./chunk.mjs";\n',
    );
    await writeFile(path.join(dir, "dist/chunk.mjs"), 'import pg from "pg";\n');
    await writeFile(path.join(dir, "dist/notes.txt"), 'import "ignored";\n');
    lines.length = 0;
    errors.length = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function manifest(dependencies: Record<string, string>) {
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies }));
    return path.join(dir, "package.json");
  }

  it("passes when the bundle imports exactly the declared packages", async () => {
    const file = await manifest({ effect: "4.1.4", pg: "^8", "@ws/shared": "workspace:*" });

    expect(await bundleImportsCommand([path.join(dir, "dist"), file], io)).toBe(0);
    expect(lines).toEqual(["The bundle imports exactly its 2 declared packages."]);
  });

  it("fails, naming each difference", async () => {
    const file = await manifest({ effect: "4.1.4", kysely: "^0.29" });

    expect(await bundleImportsCommand([path.join(dir, "dist"), file], io)).toBe(1);
    expect(errors).toEqual([
      "The bundle imports pg, which the server does not declare as a dependency, so the image would not have it.",
      "The server declares kysely, which the bundle never imports: remove it from dependencies, or bundle it.",
    ]);
  });

  it("fails when there is no bundle", async () => {
    const file = await manifest({});
    await rm(path.join(dir, "dist"), { recursive: true });
    await mkdir(path.join(dir, "dist"));

    expect(await bundleImportsCommand([path.join(dir, "dist"), file], io)).toBe(1);
    expect(errors).toEqual([
      `${path.join(dir, "dist")} holds no .mjs file: build the server first.`,
    ]);
  });

  it.each([[[]], [["dist"]], [["a", "b", "c"]]])(
    "prints the usage for %j, exit 2",
    async (argv) => {
      expect(await bundleImportsCommand(argv, io)).toBe(2);
      expect(errors).toEqual(["Usage: bundle-imports <dist> <package.json>"]);
    },
  );
});
