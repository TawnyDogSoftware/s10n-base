import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkVersionSources, readVersionSources, type VersionSources } from "./version-sources";

const consistent: VersionSources = {
  nvmrc: "26.13.1",
  enginesNode: ">=26.13.1",
  packageManager: "bun@1.4.4",
  enginesBun: ">=1.4.4",
  typesNode: "^26.6.6",
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

describe("the repository's version sources", () => {
  it("agree with each other", () => {
    const sources = readVersionSources(path.resolve(import.meta.dirname, ".."));

    expect(checkVersionSources(sources)).toEqual([]);
  });
});
