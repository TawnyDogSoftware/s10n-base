import { describe, expect, it } from "vitest";

import { checkBundleSources, packageInstances } from "./check";

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
