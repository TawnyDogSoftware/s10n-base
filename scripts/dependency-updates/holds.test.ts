import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectDeclarations, readCatalog, type Declaration, type Manifest } from "./manifests";
import { parseLockedDependencies, parseLockedVersions, resolveLockedDependency } from "./lockfile";
import {
  enforceHolds,
  findHold,
  followerMoves,
  matchesPattern,
  parseHolds,
  restoreFollowed,
  type Hold,
} from "./holds";
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

  it("rejects a file without a holds array, so a typo does not lift every hold", () => {
    expect(() => parseHolds({})).toThrow("dependency-holds.json needs a holds array");
    expect(() => parseHolds({ hold: [] })).toThrow("dependency-holds.json needs a holds array");
    expect(() => parseHolds([])).toThrow("dependency-holds.json needs a holds array");
    expect(() => parseHolds(null)).toThrow("dependency-holds.json needs a holds array");
    expect(parseHolds({ holds: [] })).toEqual([]);
  });

  it("rejects an entry without packages", () => {
    expect(() => parseHolds({ holds: [{ packages: [], reason: "x" }] })).toThrow(
      "dependency-holds.json entry 1 needs at least one package",
    );
  });

  it("rejects an entry that is not an object, and a range or group that is not text", () => {
    expect(() => parseHolds({ holds: ["react"] })).toThrow(
      "dependency-holds.json entry 1 must be an object",
    );
    expect(() => parseHolds({ holds: [{ packages: ["a"], reason: "x", range: 1 }] })).toThrow(
      "dependency-holds.json entry 1: range must be a string",
    );
    expect(() => parseHolds({ holds: [{ packages: ["a"], reason: "x", group: 1 }] })).toThrow(
      "dependency-holds.json entry 1: group must be a string",
    );
  });

  it("rejects a range it cannot read", () => {
    expect(() =>
      parseHolds({ holds: [{ packages: ["a"], reason: "x", range: "1 || 2" }] }),
    ).toThrow('Unsupported version range "1 || 2"');
  });

  it("reads a follower, whether or not the package it follows is named anywhere else", () => {
    expect(parseHolds({ holds: [{ packages: ["router"], reason: "x", follows: "auth" }] })).toEqual(
      [{ packages: ["router"], reason: "x", follows: "auth" }],
    );
  });

  it("rejects a follows that is not a package name", () => {
    for (const follows of [1, "", " ", ["auth"], null]) {
      expect(() => parseHolds({ holds: [{ packages: ["a"], reason: "x", follows }] })).toThrow(
        "dependency-holds.json entry 1: follows must be a package name",
      );
    }
  });

  it("rejects a follower that also has a range or a group, since it never moves on its own", () => {
    const follower = { packages: ["a"], reason: "x", follows: "b" };

    expect(() => parseHolds({ holds: [{ ...follower, range: "<2.0.0" }] })).toThrow(
      "dependency-holds.json entry 1: follows cannot be combined with range or group",
    );
    expect(() => parseHolds({ holds: [{ ...follower, group: "g" }] })).toThrow(
      "dependency-holds.json entry 1: follows cannot be combined with range or group",
    );
  });

  it("rejects a follower of itself or of another follower", () => {
    expect(() => parseHolds({ holds: [{ packages: ["a*"], reason: "x", follows: "ab" }] })).toThrow(
      "dependency-holds.json entry 1: follows ab, which is itself a follower",
    );
    expect(() =>
      parseHolds({
        holds: [
          { packages: ["b"], reason: "x", follows: "c" },
          { packages: ["a"], reason: "x", follows: "b" },
        ],
      }),
    ).toThrow("dependency-holds.json entry 2: follows b, which is itself a follower");
  });
});

/** Specs declared in the root catalog, the place most holds apply to. */
function declared(entries: readonly (readonly [string, string])[]): Declaration[] {
  return entries.map(([name, spec]) => ({ path: "package.json", section: "catalog", name, spec }));
}

const inCatalog = { path: "package.json", section: "catalog" } as const;

describe("enforceHolds", () => {
  const holds: readonly Hold[] = [
    { packages: ["react", "expo-*"], reason: "Expo SDK" },
    { packages: ["typescript"], range: "<6.1.0", reason: "typescript-eslint" },
    { packages: ["auth", "@auth/expo"], group: "auth", reason: "lockstep" },
  ];

  it("restores a fully held package that moved", () => {
    const restored = enforceHolds(
      holds,
      declared([
        ["react", "19.3.0"],
        ["expo-router", "~58.0.32"],
      ]),
      declared([
        ["react", "19.3.1"],
        ["expo-router", "~58.0.32"],
      ]),
    );

    expect(restored).toEqual([
      {
        ...inCatalog,
        name: "react",
        attempted: "19.3.1",
        restoredTo: "19.3.0",
        reason: "Expo SDK",
        keepLocked: true,
      },
    ]);
  });

  it("keeps a range-held package that stays in range and restores one that leaves it", () => {
    expect(
      enforceHolds(
        holds,
        declared([["typescript", "~6.0.2"]]),
        declared([["typescript", "~6.0.3"]]),
      ),
    ).toEqual([]);
    expect(
      enforceHolds(
        holds,
        declared([["typescript", "~6.0.3"]]),
        declared([["typescript", "~7.0.2"]]),
      ),
    ).toEqual([
      {
        ...inCatalog,
        name: "typescript",
        attempted: "~7.0.2",
        restoredTo: "~6.0.3",
        reason: "typescript-eslint",
        keepLocked: false,
      },
    ]);
  });

  it("moves a group only when every member lands on the same version", () => {
    const before = declared([
      ["auth", "1.7.25"],
      ["@auth/expo", "1.7.25"],
    ]);

    expect(
      enforceHolds(
        holds,
        before,
        declared([
          ["auth", "1.7.26"],
          ["@auth/expo", "1.7.26"],
        ]),
      ),
    ).toEqual([]);
    expect(
      enforceHolds(
        holds,
        before,
        declared([
          ["auth", "1.7.26"],
          ["@auth/expo", "1.7.25"],
        ]),
      ),
    ).toEqual([
      {
        ...inCatalog,
        name: "auth",
        attempted: "1.7.26",
        restoredTo: "1.7.25",
        reason: "lockstep",
        keepLocked: true,
      },
    ]);
  });

  it("compares a group's members across every place they are declared", () => {
    const inWeb = { path: "apps/web/package.json", section: "dependencies" } as const;
    const before = [
      ...declared([["auth", "1.7.25"]]),
      { ...inWeb, name: "@auth/expo", spec: "1.7.25" },
    ];
    const after = [
      ...declared([["auth", "1.7.26"]]),
      { ...inWeb, name: "@auth/expo", spec: "1.7.25" },
    ];

    expect(enforceHolds(holds, before, after)).toEqual([
      {
        ...inCatalog,
        name: "auth",
        attempted: "1.7.26",
        restoredTo: "1.7.25",
        reason: "lockstep",
        keepLocked: true,
      },
    ]);
  });

  it("restores a ranged group whose members agree on a version outside the range", () => {
    const ranged: readonly Hold[] = [
      { packages: ["db", "db-cli"], group: "db", range: "0.29.x", reason: "the adapter's range" },
    ];
    const before = declared([
      ["db", "^0.29.9"],
      ["db-cli", "^0.29.9"],
    ]);

    expect(
      enforceHolds(
        ranged,
        before,
        declared([
          ["db", "^0.29.10"],
          ["db-cli", "^0.29.10"],
        ]),
      ),
    ).toEqual([]);
    expect(
      enforceHolds(
        ranged,
        before,
        declared([
          ["db", "^0.30.0"],
          ["db-cli", "^0.30.0"],
        ]),
      ).map((restoration) => restoration.name),
    ).toEqual(["db", "db-cli"]);
  });

  it("restores a ranged group moved to a spec that is not a version", () => {
    const ranged: readonly Hold[] = [
      { packages: ["db", "db-cli"], group: "db", range: "0.29.x", reason: "the adapter's range" },
    ];
    const before = declared([
      ["db", "^0.29.9"],
      ["db-cli", "^0.29.9"],
    ]);

    expect(
      enforceHolds(
        ranged,
        before,
        declared([
          ["db", "next"],
          ["db-cli", "next"],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("restores a held package moved to a spec that is not a version", () => {
    const ranged: readonly Hold[] = [{ packages: ["ts"], range: "<6.1.0", reason: "cap" }];

    expect(enforceHolds(ranged, declared([["ts", "~6.0.3"]]), declared([["ts", "next"]]))).toEqual([
      {
        ...inCatalog,
        name: "ts",
        attempted: "next",
        restoredTo: "~6.0.3",
        reason: "cap",
        keepLocked: false,
      },
    ]);
  });

  it("applies extra holds passed by the caller", () => {
    const extra: Hold = { packages: ["@types/node"], range: "^26.0.0", reason: "Node 26" };

    expect(
      enforceHolds(
        [...holds, extra],
        declared([["@types/node", "^26.6.6"]]),
        declared([["@types/node", "^27.0.0"]]),
      ),
    ).toEqual([
      {
        ...inCatalog,
        name: "@types/node",
        attempted: "^27.0.0",
        restoredTo: "^26.6.6",
        reason: "Node 26",
        keepLocked: false,
      },
    ]);
  });
});

/** A bun.lock with these top-level versions, `auth` declaring the given dependencies. */
function lockWith(
  versions: Readonly<Record<string, string>>,
  authNeeds: Readonly<Record<string, string>>,
  nested: Readonly<Record<string, string>> = {},
): string {
  const lines = [
    ...Object.entries(versions).map(([name, version]) => {
      const meta = name === "auth" ? { dependencies: authNeeds } : {};
      return `    "${name}": ["${name}@${version}", "", ${JSON.stringify(meta)}, "sha512-x"],`;
    }),
    ...Object.entries(nested).map(
      ([name, version]) => `    "auth/${name}": ["${name}@${version}", "", {}, "sha512-x"],`,
    ),
  ];
  return `{\n  "packages": {\n${lines.join("\n\n")}\n  }\n}\n`;
}

const followerHolds: readonly Hold[] = [
  { packages: ["auth", "@auth/expo"], group: "auth", reason: "lockstep" },
  { packages: ["router"], follows: "auth", reason: "the guard's router" },
  { packages: ["react"], reason: "Expo SDK" },
];

describe("enforceHolds, for a follower", () => {
  it("never lets it move on its own", () => {
    expect(
      enforceHolds(followerHolds, declared([["router", "1.4.5"]]), declared([["router", "1.4.7"]])),
    ).toEqual([
      {
        ...inCatalog,
        name: "router",
        attempted: "1.4.7",
        restoredTo: "1.4.5",
        reason: "the guard's router",
        keepLocked: true,
      },
    ]);
  });
});

describe("followerMoves", () => {
  it("moves a follower to the version the package it follows now depends on", () => {
    const moves = followerMoves(
      followerHolds,
      declared([
        ["auth", "1.7.26"],
        ["router", "1.4.5"],
        ["react", "19.3.0"],
      ]),
      lockWith(
        { auth: "1.7.26", router: "1.4.5", react: "19.3.0" },
        { router: "1.4.6" },
        { router: "1.4.6" },
      ),
    );

    expect(moves).toEqual([
      { follower: "router", followed: "auth", followedVersion: "1.7.26", wanted: "1.4.6" },
    ]);
  });

  it("has nothing to move when the follower is already on that exact version", () => {
    expect(
      followerMoves(
        followerHolds,
        declared([
          ["auth", "1.7.25"],
          ["router", "1.4.5"],
        ]),
        lockWith({ auth: "1.7.25", router: "1.4.5" }, { router: "1.4.5" }),
      ),
    ).toEqual([]);
  });

  it("uses what the lockfile resolved when the followed package declares a range", () => {
    const specs = declared([
      ["auth", "1.7.26"],
      ["router", "1.4.5"],
    ]);

    expect(
      followerMoves(
        followerHolds,
        specs,
        lockWith({ auth: "1.7.26", router: "1.4.5" }, { router: "^1.5.0" }, { router: "1.5.2" }),
      ).map((move) => move.wanted),
    ).toEqual(["1.5.2"]);
    // The top-level copy serves the range: one copy, already agreed on.
    expect(
      followerMoves(
        followerHolds,
        specs,
        lockWith({ auth: "1.7.26", router: "1.4.5" }, { router: "^1.4.0" }),
      ),
    ).toEqual([]);
  });

  it("pins a follower declared as a range to the exact version, once for all its declarations", () => {
    const inWeb = { path: "apps/web/package.json", section: "dependencies" } as const;

    expect(
      followerMoves(
        followerHolds,
        [...declared([["router", "1.4.5"]]), { ...inWeb, name: "router", spec: "^1.4.5" }],
        lockWith({ auth: "1.7.25", router: "1.4.5" }, { router: "1.4.5" }),
      ),
    ).toEqual([
      { follower: "router", followed: "auth", followedVersion: "1.7.25", wanted: "1.4.5" },
    ]);
  });

  it("leaves a follower alone while the package it follows is not installed or does not depend on it", () => {
    const specs = declared([["router", "1.4.5"]]);

    expect(followerMoves(followerHolds, specs, lockWith({ router: "1.4.5" }, {}))).toEqual([]);
    expect(
      followerMoves(followerHolds, specs, lockWith({ auth: "1.7.26", router: "1.4.5" }, {})),
    ).toEqual([]);
  });
});

describe("restoreFollowed", () => {
  const move = { follower: "router", followed: "auth", followedVersion: "1.7.26", wanted: "1.4.6" };
  const reason =
    "router 1.4.6, which auth 1.7.26 depends on, could not be installed (blocked), so auth and the packages held with it stay where they were.";
  const kept = { ...inCatalog, reason, keepLocked: true };

  it("puts the follower, the followed package and its whole group back", () => {
    const restored = restoreFollowed(
      followerHolds,
      [move],
      {
        before: declared([
          ["auth", "1.7.25"],
          ["@auth/expo", "1.7.25"],
          ["router", "1.4.5"],
          ["react", "19.3.0"],
          ["effect", "4.1.4"],
        ]),
        after: declared([
          ["auth", "1.7.26"],
          ["@auth/expo", "1.7.26"],
          ["router", "1.4.6"],
          ["react", "19.3.0"],
          ["effect", "4.1.5"],
        ]),
        lockedBefore: new Map(),
        lockedAfter: new Map(),
      },
      "blocked",
    );

    expect(restored).toEqual([
      { ...kept, name: "auth", attempted: "1.7.26", restoredTo: "1.7.25" },
      { ...kept, name: "@auth/expo", attempted: "1.7.26", restoredTo: "1.7.25" },
      { ...kept, name: "router", attempted: "1.4.6", restoredTo: "1.4.5" },
    ]);
  });

  it("puts back a followed package outside any group, and one that moved only in the lockfile", () => {
    const holds: readonly Hold[] = [
      { packages: ["db"], range: "0.29.x", reason: "the adapter's range" },
      { packages: ["db-types"], follows: "db", reason: "must match db" },
    ];
    const specs = declared([
      ["db", "^0.29.9"],
      ["db-types", "2.0.0"],
      ["db-cli", "^0.29.9"],
      ["added", "1.0.0"],
    ]);

    const restored = restoreFollowed(
      holds,
      [{ follower: "db-types", followed: "db", followedVersion: "0.29.10", wanted: "2.0.1" }],
      {
        before: specs.slice(0, 3),
        after: specs,
        lockedBefore: new Map([
          ["db", "0.29.9"],
          ["db-types", "2.0.0"],
        ]),
        lockedAfter: new Map([
          ["db", "0.29.10"],
          ["db-types", "2.0.0"],
        ]),
      },
      "blocked",
    );

    expect(
      restored.map(({ name, attempted, restoredTo }) => [name, attempted, restoredTo]),
    ).toEqual([["db", "0.29.10", "^0.29.9"]]);
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

  it("keeps every follower on exactly the version the package it follows depends on", () => {
    const lockText = readFileSync(path.join(repoRoot, "bun.lock"), "utf8");
    const followers = heldInCatalog.flatMap(({ name, hold }) =>
      hold.follows === undefined ? [] : [{ name, followed: hold.follows }],
    );

    expect(followers).toContainEqual({ name: "better-call", followed: "better-auth" });
    for (const { name, followed } of followers) {
      // The followed package must still depend on its follower, or the hold follows nothing.
      const wanted = resolveLockedDependency(lockText, followed, name)?.version;
      expect(wanted, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(catalog.get(name), name).toBe(wanted);
      expect(locked.get(name), name).toBe(wanted);
    }
    const manifests = ["package.json", "apps/server/package.json"].map((file) => ({
      path: file,
      json: JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as Manifest,
    }));
    expect(followerMoves(holds, collectDeclarations(manifests), lockText)).toEqual([]);
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
