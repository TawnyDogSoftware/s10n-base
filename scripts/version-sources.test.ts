import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkVersionSources, readVersionSources, type VersionSources } from "./version-sources";

const DIGEST = `sha256:${"a".repeat(64)}`;

function dockerfile(node: string, bun: string): string {
  return [
    `FROM oven/bun:${bun}-slim@${DIGEST} AS bun`,
    `FROM node:${node}-slim@${DIGEST}`,
    `RUN test "$(node --version)" = "v${node}" && test "$(bun --version)" = "${bun}"`,
    "",
  ].join("\n");
}

const consistent: VersionSources = {
  nvmrc: "26.13.1",
  enginesNode: ">=26.13.1",
  packageManager: "bun@1.4.4",
  enginesBun: ">=1.4.4",
  typesNode: "^26.6.6",
  dockerfile: dockerfile("26.13.1", "1.4.4"),
};

describe("checkVersionSources", () => {
  it("accepts sources that agree", () => {
    expect(checkVersionSources(consistent)).toEqual([]);
  });

  it("requires an exact Node version in .nvmrc", () => {
    expect(checkVersionSources({ ...consistent, nvmrc: "26" })).toEqual([
      '.nvmrc must hold an exact Node version such as 26.13.1, found "26"',
    ]);
  });

  it("requires engines.node to be >= the .nvmrc version", () => {
    expect(checkVersionSources({ ...consistent, enginesNode: ">=26" })).toEqual([
      'engines.node must be ">=26.13.1" to match .nvmrc, found ">=26"',
    ]);
    expect(checkVersionSources({ ...consistent, enginesNode: undefined })).toEqual([
      'engines.node must be ">=26.13.1" to match .nvmrc, found nothing',
    ]);
  });

  it("requires packageManager to name an exact bun version", () => {
    expect(checkVersionSources({ ...consistent, packageManager: "bun@^1.4.4" })).toEqual([
      'packageManager must be "bun@<exact version>", found "bun@^1.4.4"',
    ]);
  });

  it("requires packageManager to be there and to name bun", () => {
    expect(checkVersionSources({ ...consistent, packageManager: undefined })).toEqual([
      'packageManager must be "bun@<exact version>", found nothing',
    ]);
    expect(checkVersionSources({ ...consistent, packageManager: "pnpm@10.0.0" })).toEqual([
      'packageManager must be "bun@<exact version>", found "pnpm@10.0.0"',
    ]);
  });

  it("requires engines.bun to be >= the packageManager version", () => {
    expect(checkVersionSources({ ...consistent, enginesBun: ">=1.3.0" })).toEqual([
      'engines.bun must be ">=1.4.4" to match packageManager, found ">=1.3.0"',
    ]);
  });

  it("requires @types/node on the same major as Node", () => {
    expect(checkVersionSources({ ...consistent, typesNode: "^24.10.0" })).toEqual([
      '@types/node must be on Node\'s major version 26, found "^24.10.0"',
    ]);
    expect(checkVersionSources({ ...consistent, typesNode: undefined })).toEqual([
      "@types/node must be in the root catalog",
    ]);
  });
});

describe("the Dockerfile", () => {
  it("must name the same Node and bun versions", () => {
    expect(
      checkVersionSources({ ...consistent, dockerfile: dockerfile("26.12.1", "1.4.3") }),
    ).toEqual([
      "docker/Dockerfile must use node:26.13.1, to match, found node:26.12.1-slim",
      'docker/Dockerfile must check the node version with: test "$(node --version)" = "v26.13.1"',
      "docker/Dockerfile must use oven/bun:1.4.4, to match, found oven/bun:1.4.3-slim",
      'docker/Dockerfile must check the bun version with: test "$(bun --version)" = "1.4.4"',
    ]);
  });

  it("is not checked when there is none", () => {
    expect(checkVersionSources({ ...consistent, dockerfile: undefined })).toEqual([]);
  });

  it("is checked only once the sources themselves are valid", () => {
    expect(
      checkVersionSources({ ...consistent, nvmrc: "26", dockerfile: dockerfile("1.0.0", "1.0.0") }),
    ).toEqual(['.nvmrc must hold an exact Node version such as 26.13.1, found "26"']);
    expect(
      checkVersionSources({
        ...consistent,
        packageManager: "pnpm@10.0.0",
        enginesBun: undefined,
        dockerfile: dockerfile("1.0.0", "1.0.0"),
      }),
    ).toEqual(['packageManager must be "bun@<exact version>", found "pnpm@10.0.0"']);
  });
});

describe("the repository's version sources", () => {
  it("agree with each other, the Dockerfile included", () => {
    const sources = readVersionSources(path.resolve(import.meta.dirname, ".."));

    expect(sources.dockerfile).toContain("FROM node:");
    expect(checkVersionSources(sources)).toEqual([]);
  });

  it("read no Dockerfile in a project without one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "version-sources-"));
    writeFileSync(path.join(dir, "package.json"), "{}");
    writeFileSync(path.join(dir, ".nvmrc"), "26.13.1\n");

    expect(readVersionSources(dir).dockerfile).toBeUndefined();
  });
});
