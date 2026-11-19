import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkBundleCommand, checkBundleSources, packageInstances } from "./check";

const store = (dir: string, name: string, file = "index.js") =>
  `/node_modules/.bun/${dir}/node_modules/${name}/${file}`;

const WORKSPACE = [
  "/packages/client/src/rpc.ts",
  "/packages/contracts/src/index.ts",
  "/packages/i18n/src/index.ts",
  "/packages/shared/src/app-variants.ts",
  "/apps/mobile/src/global.css",
];

/** Resolves the app's `expo` symlink into bun's store, and leaves every other directory as is. */
function resolveExpoLink(directory: string) {
  return directory === "/apps/mobile/node_modules/expo"
    ? "/node_modules/.bun/expo@58.0.25+abc/node_modules/expo"
    : directory;
}

describe("packageInstances", () => {
  it("groups files by the package directory they come from", () => {
    const instances = packageInstances([
      store("react@19.3.0", "react"),
      store("react@19.3.0", "react", "cjs/react.production.js"),
      store("@tanstack+query-core@5.107.1", "@tanstack/query-core", "build/index.js"),
      store("x@1.0.0", "x", "node_modules/react/index.js"),
    ]);

    expect(instances.get("react")).toEqual(
      new Set([
        "/node_modules/.bun/react@19.3.0/node_modules/react",
        "/node_modules/.bun/x@1.0.0/node_modules/x/node_modules/react",
      ]),
    );
    expect(instances.get("@tanstack/query-core")?.size).toBe(1);
  });
});

describe("checkBundleSources", () => {
  it("passes one React, the workspace from source, and no tests", () => {
    expect(
      checkBundleSources([
        store("react@19.3.0", "react"),
        store("react-native@0.88.1+abc", "react-native"),
        ...WORKSPACE,
      ]),
    ).toEqual([]);
  });

  it("counts a package reached through a symlink once", () => {
    const linked = "/apps/mobile/node_modules/expo/internal/async-require-module.js";
    const real = store("expo@58.0.25+abc", "expo", "src/Expo.ts");

    expect(checkBundleSources([linked, real, ...WORKSPACE], resolveExpoLink)).toEqual([]);
    expect(checkBundleSources([linked, real, ...WORKSPACE])).toHaveLength(1);
  });

  it("reports a second copy of a package that must be single", () => {
    expect(
      checkBundleSources([
        store("react@19.3.0", "react"),
        store("react@19.3.1", "react"),
        ...WORKSPACE,
      ]),
    ).toEqual([
      "2 copies of react: /node_modules/.bun/react@19.3.0/node_modules/react, /node_modules/.bun/react@19.3.1/node_modules/react",
    ]);
  });

  it("reports test code in the bundle", () => {
    expect(
      checkBundleSources([
        ...WORKSPACE,
        "/apps/mobile/src/screens/home.test.tsx",
        "/apps/mobile/src/test/native.ts",
        "/packages/client/src/testing/fake-backend.ts",
      ]),
    ).toEqual([
      "test code in the bundle: /apps/mobile/src/screens/home.test.tsx",
      "test code in the bundle: /apps/mobile/src/test/native.ts",
      "test code in the bundle: /packages/client/src/testing/fake-backend.ts",
    ]);
  });

  it("reports a workspace package that was not bundled from its source", () => {
    expect(checkBundleSources(WORKSPACE.filter((file) => !file.includes("/i18n/")))).toEqual([
      "@s10n-base/i18n is not bundled from packages/i18n/src",
    ]);
  });
});

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function capture() {
  const lines: string[] = [];
  return {
    lines,
    out: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(`! ${line}`),
    },
  };
}

/** A repository with an exported bundle whose source maps list `bundles`' sources. */
function exported(bundles: Record<string, readonly string[]>): string {
  const root = mkdtempSync(path.join(tmpdir(), "bundle-"));
  roots.push(root);
  for (const [file, sources] of Object.entries(bundles)) {
    const map = path.join(root, "apps/mobile/dist", file);
    mkdirSync(path.dirname(map), { recursive: true });
    writeFileSync(map, JSON.stringify({ sources }));
  }
  // The app's expo link points into bun's store, as bun's isolated linker leaves it.
  mkdirSync(path.join(root, "node_modules/.bun/expo@58.0.25+abc/node_modules/expo"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "apps/mobile/node_modules"), { recursive: true });
  symlinkSync(
    path.join(root, "node_modules/.bun/expo@58.0.25+abc/node_modules/expo"),
    path.join(root, "apps/mobile/node_modules/expo"),
  );
  return root;
}

const GOOD = [
  store("react@19.3.0", "react"),
  "/apps/mobile/node_modules/expo/internal/async-require-module.js",
  store("expo@58.0.25+abc", "expo", "src/Expo.ts"),
  ...WORKSPACE,
];

describe("checkBundleCommand", () => {
  it("passes every bundle that is clean, and follows the linker's symlinks", () => {
    const root = exported({
      "_expo/static/js/ios/entry.js.map": GOOD,
      "_expo/static/js/android/entry.js.map": GOOD,
    });
    const { lines, out } = capture();

    expect(checkBundleCommand([], root, out)).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /entry\.js\.map: 8 files; react from \/node_modules\/\.bun\/react@19\.3\.0/,
    );
  });

  it("lists each problem under its bundle and exits 1", () => {
    const root = exported({ "entry.js.map": [...GOOD, "/apps/mobile/src/lib/auth.test.ts"] });
    const { lines, out } = capture();

    expect(checkBundleCommand(["apps/mobile/dist"], root, out)).toBe(1);
    expect(lines).toContain("!   test code in the bundle: /apps/mobile/src/lib/auth.test.ts");
  });

  it("says where React came from even when it is missing", () => {
    const root = exported({ "entry.js.map": GOOD.filter((source) => !source.includes("react@")) });
    const { lines, out } = capture();

    checkBundleCommand([], root, out);

    expect(lines[0]).toMatch(/; react from $/);
  });

  it("exits 1 when there are no source maps to read", () => {
    const root = exported({});
    mkdirSync(path.join(root, "apps/mobile/dist"), { recursive: true });
    const { lines, out } = capture();

    expect(checkBundleCommand([], root, out)).toBe(1);
    expect(lines).toEqual(["! No source maps under apps/mobile/dist: export with --source-maps."]);
  });
});
