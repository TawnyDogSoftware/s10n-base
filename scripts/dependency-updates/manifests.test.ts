import { describe, expect, it } from "vitest";

import {
  applyDeclarations,
  collectDeclarations,
  collectSpecs,
  readCatalog,
  setRuntimeVersions,
} from "./manifests";

const root = {
  name: "root",
  workspaces: { packages: ["apps/*"], catalog: { react: "19.3.0", typescript: "~6.0.3" } },
  devDependencies: { typescript: "catalog:" },
  engines: { bun: ">=1.4.4", node: ">=26.13.1" },
  packageManager: "bun@1.4.4",
};
const app = {
  name: "app",
  dependencies: { react: "catalog:", "@scope/lib": "workspace:*", leftpad: "^1.3.0" },
};
const files = [
  { path: "package.json", json: root },
  { path: "apps/app/package.json", json: app },
];

describe("readCatalog", () => {
  it("returns the root catalog", () => {
    expect(readCatalog(root)).toEqual(
      new Map([
        ["react", "19.3.0"],
        ["typescript", "~6.0.3"],
      ]),
    );
  });

  it("returns an empty map when there is no catalog", () => {
    expect(readCatalog({})).toEqual(new Map());
  });
});

describe("collectSpecs", () => {
  it("collects catalog entries and direct version specs, skipping catalog: and workspace:", () => {
    expect(collectSpecs(files)).toEqual(
      new Map([
        ["react", "19.3.0"],
        ["typescript", "~6.0.3"],
        ["leftpad", "^1.3.0"],
      ]),
    );
  });
});

describe("collectDeclarations", () => {
  it("lists each place a package's version is written, once per place", () => {
    const twice = [
      ...files,
      { path: "apps/other/package.json", json: { devDependencies: { typescript: "^5.9.0" } } },
    ];

    expect(collectDeclarations(twice)).toEqual([
      { path: "package.json", section: "catalog", name: "react", spec: "19.3.0" },
      { path: "package.json", section: "catalog", name: "typescript", spec: "~6.0.3" },
      { path: "apps/app/package.json", section: "dependencies", name: "leftpad", spec: "^1.3.0" },
      {
        path: "apps/other/package.json",
        section: "devDependencies",
        name: "typescript",
        spec: "^5.9.0",
      },
    ]);
  });
});

describe("applyDeclarations", () => {
  it("writes each spec at its own place, the last for a place winning, and reports only changed files", () => {
    const changed = applyDeclarations(files, [
      { path: "package.json", section: "catalog", name: "react", spec: "19.3.0" },
      { path: "apps/app/package.json", section: "dependencies", name: "leftpad", spec: "^1.1.0" },
      { path: "apps/app/package.json", section: "dependencies", name: "leftpad", spec: "^1.2.0" },
      { path: "apps/app/package.json", section: "devDependencies", name: "react", spec: "19.0.0" },
      { path: "apps/app/package.json", section: "dependencies", name: "react", spec: "19.0.0" },
      { path: "apps/app/package.json", section: "dependencies", name: "absent", spec: "1.0.0" },
    ]);

    expect(changed).toEqual([
      {
        path: "apps/app/package.json",
        json: { ...app, dependencies: { ...app.dependencies, leftpad: "^1.2.0" } },
      },
    ]);
    expect(app.dependencies.leftpad).toBe("^1.3.0");
  });
});

describe("setRuntimeVersions", () => {
  it("writes bun to packageManager and engines.bun, and Node to engines.node", () => {
    expect(setRuntimeVersions(root, { bun: "1.4.5", node: "26.13.2" })).toMatchObject({
      packageManager: "bun@1.4.5",
      engines: { bun: ">=1.4.5", node: ">=26.13.2" },
    });
  });

  it("leaves a version alone when none is given", () => {
    expect(setRuntimeVersions(root, {})).toEqual(root);
  });
});
