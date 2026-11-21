import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { processGit } from "../quality/commit-attribution";
import {
  applyRules,
  BASE_NAMES,
  isKept,
  leftovers,
  lockedEntries,
  type ProjectNames,
  renameRules,
  trackedTextFiles,
  versionChanges,
} from "./rules";

const ACME: ProjectNames = {
  name: "Acme Notes",
  scope: "@acme",
  slug: "acme-notes",
  bundleId: "com.acme.notes",
  scheme: "acmenotes",
  cookiePrefix: "acme",
};

function renamed(text: string, names: ProjectNames = ACME): string {
  return applyRules(text, renameRules(names)).text;
}

/** Each kind of replacement, on lines in the forms the repository uses them. */
const CASES: ReadonlyArray<readonly [kind: string, before: string, after: string]> = [
  ["a manifest's name", `"name": "@s10n-base/web",`, `"name": "@acme/web",`],
  [
    "a workspace dependency",
    `"@s10n-base/client": "workspace:*",`,
    `"@acme/client": "workspace:*",`,
  ],
  [
    "an import",
    `import { x } from "@s10n-base/client/rpc";`,
    `import { x } from "@acme/client/rpc";`,
  ],
  ["a CSS import", `@import "@s10n-base/theme/theme.css";`, `@import "@acme/theme/theme.css";`],
  [
    "the bundler's pattern",
    String.raw`alwaysBundle: [/^@s10n-base\//]`,
    String.raw`alwaysBundle: [/^@acme\//]`,
  ],
  [
    "a turbo filter",
    "turbo run dev --filter=@s10n-base/server",
    "turbo run dev --filter=@acme/server",
  ],
  [
    "a bundle identifier",
    `bundleIdentifier: "com.example.s10nbase.dev",`,
    `bundleIdentifier: "com.acme.notes.dev",`,
  ],
  [
    "a variant's display name",
    `displayName: "S10N Base (Preview)",`,
    `displayName: "Acme Notes (Preview)",`,
  ],
  ["the page title", "<title>S10N Base</title>", "<title>Acme Notes</title>"],
  ["the catalog's app name", `appName: "S10N Base",`, `appName: "Acme Notes",`],
  ["a cookie", `"s10n-base.session_token=abc; Path=/"`, `"acme.session_token=abc; Path=/"`],
  [
    "a cookie pattern",
    String.raw`toMatch(/^s10n-base\.[a-z_]+=/)`,
    String.raw`toMatch(/^acme\.[a-z_]+=/)`,
  ],
  [
    "the cookie prefix constant",
    `export const AUTH_COOKIE_PREFIX = "s10n-base";`,
    `export const AUTH_COOKIE_PREFIX = "acme";`,
  ],
  ["a URL scheme", `urlScheme: "s10nbase-dev",`, `urlScheme: "acmenotes-dev",`],
  [
    "a trusted origin",
    `["https://app.example.com", "s10nbase://"]`,
    `["https://app.example.com", "acmenotes://"]`,
  ],
  [
    "a database URL",
    "postgres://s10n_base:s10n_base@127.0.0.1:54320/s10n_base_test",
    "postgres://acme_notes:acme_notes@127.0.0.1:54320/acme_notes_test",
  ],
  [
    "the test database's SQL",
    "CREATE DATABASE s10n_base_test OWNER s10n_base;",
    "CREATE DATABASE acme_notes_test OWNER acme_notes;",
  ],
  ["the root package's name", `"name": "s10n-base",`, `"name": "acme-notes",`],
  ["the Expo slug", `slug: "s10n-base",`, `slug: "acme-notes",`],
  ["the dev client's scheme", "(`exp+s10n-base`)", "(`exp+acme-notes`)"],
  ["the compose project", "name: s10n-base-local", "name: acme-notes-local"],
  ["the image tag", "-t s10n-base:local .", "-t acme-notes:local ."],
  [
    "the image title label",
    `LABEL org.opencontainers.image.title="s10n-base"`,
    `LABEL org.opencontainers.image.title="acme-notes"`,
  ],
  ["the client-IP header", `"x-s10n-base-client-ip"`, `"x-acme-notes-client-ip"`],
  ["an Effect service key", `("s10n-base/server/AppConfig")`, `("acme-notes/server/AppConfig")`],
];

describe("renameRules", () => {
  it.each(CASES)("rewrites %s", (_kind, before, after) => {
    expect(renamed(before)).toBe(after);
  });

  it("leaves no spelling of the base's name in any case", () => {
    const all = CASES.map(([, before]) => before).join("\n");

    expect(leftovers([{ file: "x", text: renamed(all) }])).toEqual([]);
  });

  it("uses the slug for the cookie prefix when they are the same", () => {
    expect(renamed(`"s10n-base.session_token"`, { ...ACME, cookiePrefix: ACME.slug })).toBe(
      `"acme-notes.session_token"`,
    );
  });

  it("changes nothing when given the base's own names", () => {
    const all = CASES.map(([, before]) => before).join("\n");

    expect(renamed(all, BASE_NAMES)).toBe(all);
  });

  it("counts each rule's matches", () => {
    const { counts } = applyRules(`"@s10n-base/a" "@s10n-base/b" "S10N Base"`, renameRules(ACME));

    expect([...counts]).toEqual([
      ["package scope", 2],
      ["display name", 1],
    ]);
  });
});

describe("isKept", () => {
  it("keeps the base's history and this script", () => {
    for (const file of [
      "plans/000-hosted-starter-rework.md",
      "plans/README.md",
      "CHANGELOG.md",
      "docs/adr/001-effect-core-on-the-server.md",
      "docs/new-project.md",
      "scripts/rename/rules.ts",
    ]) {
      expect(isKept(file), file).toBe(true);
    }
  });

  it("renames everything else", () => {
    for (const file of ["README.md", "docs/setup.md", "apps/CHANGELOG.md", "docs/adr.md"]) {
      expect(isKept(file), file).toBe(false);
    }
  });
});

describe("leftovers", () => {
  it("names each line outside the kept files that still names the base", () => {
    const files = [
      { file: "docs/setup.md", text: "fine\n  `S10N_BASE_PORT` is gone\nAPP-SCAFFOLD" },
      { file: "plans/001-x.md", text: "s10n-base" },
    ];

    expect(leftovers(files)).toEqual([
      "docs/setup.md:2: `S10N_BASE_PORT` is gone",
      "docs/setup.md:3: APP-SCAFFOLD",
    ]);
  });
});

const LOCKFILE = `{
  "workspaces": {
    "": {
      "name": "s10n-base",
    },
  },
  "packages": {
    "@s10n-base/client": ["@s10n-base/client@workspace:packages/client"],

    "kysely": ["kysely@0.29.9", "", {}, "sha512-x"],

    "@babel/core/semver": ["semver@6.3.1", "", { "bin": {} }, "sha512-y"],

    "semver": ["semver@7.7.2", "", {}, "sha512-z"],
  }
}
`;

describe("lockedEntries", () => {
  it("lists the third-party versions the lockfile resolves, without workspace entries", () => {
    expect(lockedEntries(LOCKFILE)).toEqual([
      "kysely@0.29.9",
      "semver@6.3.1 (@babel/core/semver)",
      "semver@7.7.2",
    ]);
  });

  it("is the same after a rename, which touches only the workspace names", () => {
    expect(lockedEntries(renamed(LOCKFILE))).toEqual(lockedEntries(LOCKFILE));
    expect(renamed(LOCKFILE)).toContain(
      `"@acme/client": ["@acme/client@workspace:packages/client"]`,
    );
    expect(renamed(LOCKFILE)).toContain(`"name": "acme-notes",`);
  });
});

describe("a lockfile whose entries moved without changing its set of versions", () => {
  // bun resolved @babel/core's semver to 7.7.2 and another package's to 6.3.1: the same two
  // versions as before, each now at another path (plan 011, F30).
  const moved = LOCKFILE.replace(
    `"@babel/core/semver": ["semver@6.3.1"`,
    `"@babel/core/semver": ["semver@7.7.2"`,
  ).replace(
    `    "semver": ["semver@7.7.2", "", {}, "sha512-z"],`,
    `    "semver": ["semver@7.7.2", "", {}, "sha512-z"],\n\n    "other/semver": ["semver@6.3.1", "", {}, "sha512-y"],`,
  );

  it("is a change", () => {
    expect(versionChanges(lockedEntries(LOCKFILE), lockedEntries(moved))).toEqual([
      "- semver@6.3.1 (@babel/core/semver)",
      "+ semver@6.3.1 (other/semver)",
      "+ semver@7.7.2 (@babel/core/semver)",
    ]);
  });
});

describe("versionChanges", () => {
  it("lists what went and what came", () => {
    expect(versionChanges(["a@1", "b@1"], ["a@1", "b@2"])).toEqual(["- b@1", "+ b@2"]);
    expect(versionChanges(["a@1"], ["a@1"])).toEqual([]);
  });
});

describe("trackedTextFiles", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  it("reads every file git tracks, and skips binary ones", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rename-rules-"));
    made.push(root);
    writeFileSync(path.join(root, "a.txt"), "S10N Base\n");
    writeFileSync(path.join(root, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    writeFileSync(path.join(root, "untracked.txt"), "s10n\n");
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "a.txt", "image.png"], { cwd: root });

    expect(trackedTextFiles(processGit(root), root)).toEqual([
      { file: "a.txt", text: "S10N Base\n" },
    ]);
  });
});
