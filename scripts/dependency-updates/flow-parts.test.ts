/** The flow's steps one at a time, for the cases the whole-flow scenarios do not reach. */
import { describe, expect, it } from "vitest";

import {
  bunVersionOf,
  checkExpo,
  findOpenPrs,
  mustRun,
  packagesHeldByAge,
  readBase,
  readManifests,
  versionChanges,
  type CommandResult,
  type Io,
} from "./flow";

/** An Io over `files`, answering commands and requests from the given functions. */
function io(
  files: Record<string, string>,
  answers: {
    readonly run?: (line: string) => CommandResult;
    readonly fetchJson?: (url: string) => unknown;
  } = {},
): Io & { readonly logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    run: (command, args) =>
      Promise.resolve(
        answers.run?.([command, ...args].join(" ")) ?? { code: 0, stdout: "", stderr: "" },
      ),
    readFile: (path) => {
      const text = files[path];
      return text === undefined
        ? Promise.reject(new Error(`ENOENT ${path}`))
        : Promise.resolve(text);
    },
    writeFile: () => Promise.resolve(),
    exists: (path) => Promise.resolve(path in files),
    glob: (pattern) =>
      Promise.resolve(
        Object.keys(files).filter(
          (path) =>
            path.startsWith(pattern.replace("*/package.json", "")) && path !== "package.json",
        ),
      ),
    fetchJson: (url) =>
      answers.fetchJson === undefined
        ? Promise.reject(new Error(`unexpected ${url}`))
        : Promise.resolve(answers.fetchJson(url)),
    fetchHeaders: (url) => Promise.reject(new Error(`unexpected HEAD ${url}`)),
    log: (line) => logs.push(line),
  };
}

describe("mustRun", () => {
  it("names the command, its code and its output when it fails, from stdout if stderr is empty", async () => {
    const failing = io(
      {},
      { run: () => ({ code: 2, stdout: "conflict in bun.lock\n", stderr: "" }) },
    );

    await expect(mustRun(failing, "git", ["merge", "x"])).rejects.toThrow(
      "git merge x failed (exit 2): conflict in bun.lock",
    );
  });
});

describe("readManifests", () => {
  it("reads only the root manifest of a repo without workspaces", async () => {
    const files = io({ "package.json": '{"name":"solo"}' });

    expect(await readManifests(files)).toEqual([{ path: "package.json", json: { name: "solo" } }]);
  });

  it("keeps only the text patterns of the workspace list", async () => {
    const files = io({
      "package.json": '{"workspaces":{"packages":["apps/*",7]}}',
      "apps/web/package.json": '{"name":"web"}',
    });

    expect((await readManifests(files)).map((file) => file.path)).toEqual([
      "package.json",
      "apps/web/package.json",
    ]);
  });
});

describe("findOpenPrs", () => {
  it("takes the updater's open PRs, newest first", async () => {
    const pr = { baseRefName: "main", isCrossRepository: false, headRefOid: "sha", body: "" };
    const prs = [
      { ...pr, number: 4, headRefName: "deps/update-2026-11-17", url: "u4" },
      { ...pr, number: 9, headRefName: "deps/update-2026-11-18", url: "u9" },
      { ...pr, number: 11, headRefName: "deps/update-latest", url: "u11" },
    ];
    const github = io({}, { run: () => ({ code: 0, stdout: JSON.stringify(prs), stderr: "" }) });

    const found = await findOpenPrs(github, {
      dryRun: false,
      baseBranch: "main",
      now: new Date("2026-11-19T00:00:00Z"),
      label: "dependency-update",
      author: { name: "a", email: "a@example.invalid" },
    });

    expect(found.map((open) => open.number)).toEqual([9, 4]);
    expect(github.logs).toEqual([
      "Leaving PR #11 alone: it has the dependency-update label but is not the updater's (head deps/update-latest into main).",
    ]);
  });
});

describe("bunVersionOf", () => {
  it("is the version packageManager names, or empty when it names none", () => {
    expect(bunVersionOf({ packageManager: "bun@1.4.4" })).toBe("1.4.4");
    expect(bunVersionOf({})).toBe("");
    expect(bunVersionOf(undefined)).toBe("");
  });
});

describe("readBase", () => {
  it("reads what the base commit has, and treats a missing file as empty", async () => {
    const base = io(
      {
        "package.json": '{"workspaces":{"packages":["apps/*"]}}',
        "apps/web/package.json": "{}",
      },
      {
        run: (line) =>
          line === "git show base:package.json"
            ? {
                code: 0,
                stdout: '{"packageManager":"bun@1.4.4","workspaces":{"catalog":{"vite":"^8.3.8"}}}',
                stderr: "",
              }
            : { code: 128, stdout: "", stderr: "fatal: path not in tree" },
      },
    );

    expect(await readBase(base, "base")).toEqual({
      specs: new Map([["vite", "^8.3.8"]]),
      locked: new Map(),
      node: "",
      bun: "1.4.4",
    });
  });
});

describe("checkExpo", () => {
  it("has nothing to report when Expo's packages match the SDK", async () => {
    const mobile = io({ "apps/mobile/package.json": "{}" });

    expect(await checkExpo(mobile)).toEqual([]);
  });

  it("says the check could not run when it fails without naming drift", async () => {
    const offline = io(
      { "apps/mobile/package.json": "{}" },
      { run: () => ({ code: 1, stdout: "", stderr: "TypeError: fetch failed\n" }) },
    );

    expect(await checkExpo(offline)).toEqual([
      "`expo install --check` in apps/mobile could not run (exit 1), so Expo drift is not checked:\n\n  ```\n  TypeError: fetch failed\n  ```",
    ]);
  });
});

describe("packagesHeldByAge", () => {
  const outdated = `| Package | Current | Update | Latest | Workspace |
|---|---|---|---|---|
| oxlint | 1.93.0 | 1.93.0 | 1.93.0 * | catalog (root) |
| knip (dev) | 6.45.1 | 6.45.1 * | 6.45.1 * | catalog (root) |
`;

  it("keeps the package without its newest release when the registry cannot be reached", async () => {
    const offline = io(
      {},
      {
        run: () => ({ code: 0, stdout: outdated, stderr: "" }),
        fetchJson: () => {
          throw new Error("registry unreachable");
        },
      },
    );

    expect(await packagesHeldByAge(offline)).toEqual([
      { name: "oxlint", current: "1.93.0" },
      { name: "knip", current: "6.45.1" },
    ]);
  });

  it("leaves out what the registry does not say", async () => {
    const registry = io(
      {},
      {
        run: () => ({ code: 0, stdout: outdated, stderr: "" }),
        fetchJson: (url) => (url.endsWith("/oxlint") ? { "dist-tags": { latest: "1.94.0" } } : {}),
      },
    );

    expect(await packagesHeldByAge(registry)).toEqual([
      { name: "oxlint", current: "1.93.0", newest: "1.94.0" },
      { name: "knip", current: "6.45.1" },
    ]);
  });
});

describe("packagesHeldByAge, when only the in-range column is held back", () => {
  // The age gate holds back a release inside the spec (0.28.20); the registry's `latest` (0.29.9)
  // is outside the spec and old enough, so it is not what the gate held back.
  const outdated = `| Package | Current | Update | Latest | Workspace |
|---|---|---|---|---|
| kysely | 0.28.19 | 0.28.19 * | 0.29.9 | catalog (root) |
`;

  it("reports the newest release between that column and the latest column", async () => {
    const registry = io(
      {},
      {
        run: () => ({ code: 0, stdout: outdated, stderr: "" }),
        fetchJson: () => ({
          "dist-tags": { latest: "0.29.9", next: "0.30.0-beta.2" },
          time: {
            created: "2020-01-01T00:00:00.000Z",
            "0.28.19": "2026-11-01T02:23:45.998Z",
            "0.28.20": "2026-11-18T17:42:46.860Z",
            "0.29.9": "2026-11-12T16:48:02.551Z",
            "0.30.0-beta.2": "2026-11-18T00:40:59.594Z",
          },
        }),
      },
    );

    expect(await packagesHeldByAge(registry)).toEqual([
      {
        name: "kysely",
        current: "0.28.19",
        newest: "0.28.20",
        publishedAt: "2026-11-18T17:42:46.860Z",
      },
    ]);
  });

  it("reports no newest release when the registry lists none in that span", async () => {
    const registry = io(
      {},
      {
        run: () => ({ code: 0, stdout: outdated, stderr: "" }),
        fetchJson: () => ({ "dist-tags": { latest: "0.29.9" } }),
      },
    );

    expect(await packagesHeldByAge(registry)).toEqual([{ name: "kysely", current: "0.28.19" }]);
  });
});

describe("versionChanges", () => {
  it("leaves out names missing on either side, unchanged ones and specs that are not versions", () => {
    const before = new Map([
      ["vite", "8.3.8"],
      ["effect", "4.1.4"],
      ["@s10n-base/client", "workspace:packages/client"],
      ["gone", "1.0.0"],
    ]);
    const after = new Map([
      ["vite", "9.0.1"],
      ["effect", "4.1.4"],
      ["@s10n-base/client", "workspace:packages/client2"],
      ["new", "1.0.0"],
    ]);

    expect(versionChanges([...before.keys(), "new"], before, after)).toEqual([
      { name: "vite", from: "8.3.8", to: "9.0.1", kind: "major" },
    ]);
  });
});
