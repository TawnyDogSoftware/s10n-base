import { describe, expect, it } from "vitest";

import { parseLockedVersions } from "./lockfile";

const lock = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "devDependencies": {
        "typescript": "catalog:",
      },
    },
  },
  "catalog": {
    "typescript": "~6.0.3",
  },
  "packages": {
    "@types/node": ["@types/node@26.6.6", "", { "dependencies": { "undici-types": "~8.9.0" } }, "sha512-x"],

    "typescript": ["typescript@6.0.3", "", { "bin": { "tsc": "bin/tsc" } }, "sha512-y"],

    "postcss/source-map-js": ["source-map-js@1.2.2", "", {}, "sha512-z"],
  }
}
`;

describe("parseLockedVersions", () => {
  it("reads the version each top-level package resolves to", () => {
    expect(parseLockedVersions(lock)).toEqual(
      new Map([
        ["@types/node", "26.6.6"],
        ["typescript", "6.0.3"],
      ]),
    );
  });
});
