import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readCatalog, type Manifest } from "./manifests";
import { parseLockedDependencies, parseLockedVersions } from "./lockfile";
import { enforceHolds, findHold, matchesPattern, parseHolds, type Hold } from "./holds";
import { satisfies, specBaseVersion } from "./semver";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("matchesPattern", () => {
  it("matches names exactly or with a * wildcard", () => {
    expect(matchesPattern("react", "react")).toBe(true);
    expect(matchesPattern("react-dom", "react")).toBe(false);
    expect(matchesPattern("expo-router", "expo-*")).toBe(true);
    expect(matchesPattern("expo", "expo-*")).toBe(false);
    expect(matchesPattern("@expo/cli", "@expo/*")).toBe(true);
  });
});

describe("parseHolds", () => {
  it("rejects an entry without a reason", () => {
    expect(() => parseHolds({ holds: [{ packages: ["react"], reason: " " }] })).toThrow(
      "dependency-holds.json entry 1 needs a reason",
    );
  });

  it("rejects an entry without packages", () => {
    expect(() => parseHolds({ holds: [{ packages: [], reason: "x" }] })).toThrow(
      "dependency-holds.json entry 1 needs at least one package",
    );
  });

  it("rejects a range it cannot read", () => {
    expect(() =>
      parseHolds({ holds: [{ packages: ["a"], reason: "x", range: "1 || 2" }] }),
    ).toThrow('Unsupported version range "1 || 2"');
  });
});

describe("enforceHolds", () => {
  const holds: readonly Hold[] = [
    { packages: ["react", "expo-*"], reason: "Expo SDK" },
    { packages: ["typescript"], range: "<6.1.0", reason: "typescript-eslint" },
    { packages: ["auth", "@auth/expo"], group: "auth", reason: "lockstep" },
  ];

  it("restores a fully held package that moved", () => {
    const restored = enforceHolds(
      holds,
      new Map([
        ["react", "19.3.0"],
        ["expo-router", "~58.0.32"],
      ]),
      new Map([
        ["react", "19.3.1"],
        ["expo-router", "~58.0.32"],
      ]),
    );

    expect(restored).toEqual([
      { name: "react", attempted: "19.3.1", restoredTo: "19.3.0", reason: "Expo SDK" },
    ]);
  });

  it("keeps a range-held package that stays in range and restores one that leaves it", () => {
    expect(
      enforceHolds(holds, new Map([["typescript", "~6.0.2"]]), new Map([["typescript", "~6.0.3"]])),
    ).toEqual([]);
    expect(
      enforceHolds(holds, new Map([["typescript", "~6.0.3"]]), new Map([["typescript", "~7.0.2"]])),
    ).toEqual([
      {
        name: "typescript",
        attempted: "~7.0.2",
        restoredTo: "~6.0.3",
        reason: "typescript-eslint",
      },
    ]);
  });

  it("moves a group only when every member lands on the same version", () => {
    const before = new Map([
      ["auth", "1.7.25"],
      ["@auth/expo", "1.7.25"],
    ]);

    expect(
      enforceHolds(
        holds,
        before,
        new Map([
          ["auth", "1.7.26"],
          ["@auth/expo", "1.7.26"],
        ]),
      ),
    ).toEqual([]);
    expect(
      enforceHolds(
        holds,
        before,
        new Map([
          ["auth", "1.7.26"],
          ["@auth/expo", "1.7.25"],
        ]),
      ),
    ).toEqual([{ name: "auth", attempted: "1.7.26", restoredTo: "1.7.25", reason: "lockstep" }]);
  });

  it("applies extra holds passed by the caller", () => {
    const extra: Hold = { packages: ["@types/node"], range: "^26.0.0", reason: "Node 26" };

    expect(
      enforceHolds(
        [...holds, extra],
        new Map([["@types/node", "^26.6.6"]]),
        new Map([["@types/node", "^27.0.0"]]),
      ),
    ).toEqual([
      { name: "@types/node", attempted: "^27.0.0", restoredTo: "^26.6.6", reason: "Node 26" },
    ]);
  });
});

describe("dependency-holds.json", () => {
  const holds = parseHolds(
    JSON.parse(readFileSync(path.join(repoRoot, "dependency-holds.json"), "utf8")) as unknown,
  );
  const catalog = readCatalog(
    JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as Manifest,
  );
  const locked = parseLockedVersions(readFileSync(path.join(repoRoot, "bun.lock"), "utf8"));
  const heldInCatalog = [...catalog.keys()].flatMap((name) => {
    const hold = findHold(holds, name);
    return hold === undefined ? [] : [{ name, hold }];
  });

  it("gives every entry a reason", () => {
    for (const hold of holds) {
      expect(hold.reason.trim()).not.toBe("");
    }
  });

  it("is satisfied by every held package in the catalog and the lockfile", () => {
    for (const { name, hold } of heldInCatalog) {
      if (hold.range === undefined) continue;
      expect(satisfies(specBaseVersion(catalog.get(name) ?? "") ?? "", hold.range), name).toBe(
        true,
      );
      expect(satisfies(locked.get(name) ?? "", hold.range), name).toBe(true);
    }
  });

  it("keeps every member of a group on the same version", () => {
    const groups = new Map<string, Set<string>>();
    for (const { name, hold } of heldInCatalog) {
      if (hold.group === undefined) continue;
      const versions = groups.get(hold.group) ?? new Set();
      versions.add(specBaseVersion(catalog.get(name) ?? "") ?? "");
      groups.set(hold.group, versions);
    }
    for (const [group, versions] of groups) {
      expect(versions.size, group).toBe(1);
    }
  });

  it("holds the packages the plan names", () => {
    for (const name of [
      "react",
      "react-dom",
      "react-native",
      "expo-router",
      "typescript",
      "kysely",
    ]) {
      expect(findHold(holds, name), name).toBeDefined();
    }
    expect(
      ["better-auth", "@better-auth/expo", "@better-auth/passkey"].map(
        (name) => findHold(holds, name)?.group,
      ),
    ).toEqual(["better-auth", "better-auth", "better-auth"]);
  });

  it("pins better-call to exactly the version better-auth depends on", () => {
    // Better Auth does not re-export its router; the route guard imports better-call itself
    // and must match with the very same version (plan 004, section 3).
    const lockText = readFileSync(path.join(repoRoot, "bun.lock"), "utf8");
    const wanted = parseLockedDependencies(lockText, "better-auth")?.get("better-call");

    expect(wanted).toMatch(/^\d+\.\d+\.\d+$/);
    expect(catalog.get("better-call")).toBe(wanted);
    expect(locked.get("better-call")).toBe(wanted);
  });

  it("pins the better-auth group exactly", () => {
    for (const name of ["better-auth", "@better-auth/expo", "@better-auth/passkey"]) {
      expect(catalog.get(name), name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(locked.get(name), name).toBe(catalog.get(name));
    }
  });
});
