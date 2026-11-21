import { describe, expect, it } from "vitest";

import { parseLockedDependencies, parseLockedVersions, resolveLockedDependency } from "./lockfile";

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

// As bun 1.4.4 writes it: a dependency the top-level copy cannot serve gets its own entry under
// "<parent>/<name>"; one the top-level copy serves has no entry of its own.
function entries(lines: readonly string[]): string {
  return `{\n  "lockfileVersion": 1,\n  "packages": {\n${lines.join("\n\n")}\n  }\n}\n`;
}

function auth(spec: string): string {
  return `    "auth": ["auth@1.7.26", "", { "dependencies": { "auth-router": "${spec}", "zod": "^4.5.4" } }, "sha512-a"],`;
}

function router(key: string, version: string): string {
  return `    "${key}": ["auth-router@${version}", "", {}, "sha512-r"],`;
}

describe("resolveLockedDependency", () => {
  it("is the declared version when the parent pins its dependency exactly", () => {
    const text = entries([auth("1.4.6"), router("auth-router", "1.4.5")]);

    expect(resolveLockedDependency(text, "auth", "auth-router")).toEqual({
      parentVersion: "1.7.26",
      version: "1.4.6",
    });
  });

  it("is the parent's own copy when it declares a range the top-level copy is outside", () => {
    const text = entries([
      auth("^1.5.0"),
      router("auth-router", "1.4.5"),
      router("auth/auth-router", "1.5.2"),
    ]);

    expect(resolveLockedDependency(text, "auth", "auth-router")?.version).toBe("1.5.2");
  });

  it("is the top-level copy when it declares a range that copy is inside", () => {
    const text = entries([auth("^1.4.0"), router("auth-router", "1.4.5")]);

    expect(resolveLockedDependency(text, "auth", "auth-router")?.version).toBe("1.4.5");
  });

  it("reads a scoped parent's own copy", () => {
    const text = entries([
      `    "@auth/core": ["@auth/core@2.0.0", "", { "dependencies": { "auth-router": "~1.5.0" } }, "sha512-c"],`,
      router("auth-router", "1.4.5"),
      router("@auth/core/auth-router", "1.5.2"),
    ]);

    expect(resolveLockedDependency(text, "@auth/core", "auth-router")).toEqual({
      parentVersion: "2.0.0",
      version: "1.5.2",
    });
  });

  it("is undefined when the parent is not installed, does not depend on the package, or the range resolved to nothing", () => {
    const text = entries([auth("^1.4.0")]);

    expect(resolveLockedDependency(text, "other", "auth-router")).toBeUndefined();
    expect(resolveLockedDependency(text, "auth", "react")).toBeUndefined();
    expect(resolveLockedDependency(text, "auth", "auth-router")).toBeUndefined();
  });
});
