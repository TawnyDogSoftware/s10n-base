// @vitest-environment node
// Metro's config runs in Node, not in the app.
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(import.meta.dirname, "../..");
const config = require(path.join(appRoot, "metro.config.cjs")) as {
  resolver: { blockList: RegExp | RegExp[] };
};
const patterns = ([] as RegExp[]).concat(config.resolver.blockList);
const blocked = (file: string) => patterns.some((pattern) => pattern.test(file));

describe("metro.config.cjs", () => {
  it.each([
    "src/screens/sign-in.test.tsx",
    "src/lib/auth.test.ts",
    "src/test/native.ts",
    "src/test/render.tsx",
  ])("keeps %s out of every bundle", (file) => {
    expect(blocked(path.join(appRoot, file))).toBe(true);
  });

  it("keeps the workspace packages' tests out too", () => {
    expect(blocked(path.resolve(appRoot, "../../packages/client/src/rpc.test.ts"))).toBe(true);
  });

  it.each(["src/screens/sign-in.tsx", "src/app/(app)/index.tsx", "src/lib/auth.ts"])(
    "bundles %s",
    (file) => {
      expect(blocked(path.join(appRoot, file))).toBe(false);
    },
  );

  it("leaves files in node_modules alone, even ones named like tests", () => {
    expect(blocked(path.join(appRoot, "node_modules/some-lib/src/test/index.js"))).toBe(false);
    expect(blocked(path.join(appRoot, "node_modules/some-lib/lib/thing.test.js"))).toBe(false);
  });
});
