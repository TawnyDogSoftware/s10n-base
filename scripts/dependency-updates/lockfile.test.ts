import { describe, expect, it } from "vitest";

import { parseLockedDependencies, parseLockedVersions } from "./lockfile";

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

describe("parseLockedDependencies", () => {
  it("reads the dependencies a top-level package's own manifest declares", () => {
    expect(parseLockedDependencies(lock, "@types/node")).toEqual(
      new Map([["undici-types", "~8.9.0"]]),
    );
  });

  it("is empty for a package with no dependencies", () => {
    expect(parseLockedDependencies(lock, "typescript")).toEqual(new Map());
  });

  it("is undefined for a package that is not in the lockfile", () => {
    expect(parseLockedDependencies(lock, "source-map-js")).toBeUndefined();
  });
});
