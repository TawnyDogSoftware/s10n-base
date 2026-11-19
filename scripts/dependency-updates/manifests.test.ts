import { describe, expect, it } from "vitest";

import { applySpecs, collectSpecs, readCatalog, setRuntimeVersions } from "./manifests";

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

describe("applySpecs", () => {
  it("writes specs back where they are declared and reports only changed files", () => {
    const changed = applySpecs(
      files,
      new Map([
        ["react", "19.3.0"],
        ["leftpad", "^1.2.0"],
      ]),
    );

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
