import { describe, expect, it } from "vitest";

import { runDependencyUpdate, type CommandResult, type FlowOptions, type Io } from "./flow";

const NOW = new Date("2026-11-19T00:10:00Z");

const holdsFile = JSON.stringify({
  holds: [
    { packages: ["react"], reason: "Owned by the Expo SDK." },
    { packages: ["typescript"], range: "<6.1.0", reason: "typescript-eslint caps TypeScript." },
  ],
});

function rootManifest(catalog: Record<string, string>, bun = "1.4.4", node = "26.13.1"): string {
  return `${JSON.stringify(
    {
      name: "root",
      workspaces: { packages: ["apps/*"], catalog },
      engines: { bun: `>=${bun}`, node: `>=${node}` },
      packageManager: `bun@${bun}`,
    },
    null,
    2,
  )}\n`;
}

function lockfile(versions: Record<string, string>): string {
  const entries = Object.entries(versions)
    .map(([name, version]) => `    "${name}": ["${name}@${version}", "", {}, "sha512-x"],`)
    .join("\n\n");
  return `{\n  "lockfileVersion": 1,\n  "packages": {\n${entries}\n  }\n}\n`;
}

const outdatedOutput = `bun outdated v1.4.4 (38afee6c8)
| Package | Current | Update   | Latest   | Workspace    |
|---------|---------|----------|----------|--------------|
| oxlint  | 1.93.0  | 1.93.0   | 1.93.0 * | catalog (root) |
`;

interface Scenario {
  readonly openPr?: { number: number; headRefName: string; url: string };
  readonly mergeConflicts?: boolean;
  /** Catalog and lockfile that `bun update -r --latest` produces. */
  readonly latest?: { catalog: Record<string, string>; lock: Record<string, string> };
  readonly bunReleases?: unknown[];
  readonly nodeIndex?: unknown[];
  readonly mobileApp?: boolean;
  /** Catalog and lockfile on the open PR's branch, when it differs from main. */
  readonly prHead?: { catalog: Record<string, string>; lock: Record<string, string> };
}

const startCatalog = {
  effect: "4.1.4",
  react: "19.3.0",
  typescript: "~6.0.3",
  vite: "^8.3.8",
  oxlint: "1.93.0",
};
const startLock = {
  effect: "4.1.4",
  react: "19.3.0",
  typescript: "6.0.3",
  vite: "8.3.8",
  oxlint: "1.93.0",
};

function ok(stdout = ""): Promise<CommandResult> {
  return Promise.resolve({ code: 0, stdout, stderr: "" });
}

class FakeIo implements Io {
  files = new Map<string, string>();
  readonly commands: string[] = [];
  readonly logs: string[] = [];
  readonly inputs = new Map<string, string>();

  constructor(private readonly scenario: Scenario) {
    this.files.set("package.json", rootManifest(startCatalog));
    this.files.set(
      "apps/web/package.json",
      `${JSON.stringify({ name: "web", dependencies: { react: "catalog:" } }, null, 2)}\n`,
    );
    this.files.set("bun.lock", lockfile(startLock));
    this.files.set(".nvmrc", "26.13.1\n");
    this.files.set("dependency-holds.json", holdsFile);
    if (scenario.mobileApp === true) this.files.set("apps/mobile/package.json", "{}");
  }

  /** The files as they were when the starting point was checked out. */
  private atCheckout = new Map<string, string>();
  /** The files on main, captured when the flow starts. */
  private atBase: Map<string, string> | undefined;

  private static readonly shas: Record<string, string> = {
    "origin/main": "base-sha",
    HEAD: "caller-sha",
  };

  run(
    command: string,
    args: readonly string[],
    options?: { cwd?: string; input?: string },
  ): Promise<CommandResult> {
    const line = [command, ...args].join(" ");
    this.commands.push(line);
    if (options?.input !== undefined) this.inputs.set(line, options.input);
    this.atBase ??= new Map(this.files);
    return this.git(line, this.atBase) ?? this.bun(line) ?? this.gh(line) ?? ok();
  }

  private git(line: string, atBase: Map<string, string>): Promise<CommandResult> | undefined {
    const revParse = /^git rev-parse --verify (.+)\^\{commit\}$/.exec(line);
    if (revParse !== null) return ok(`${FakeIo.shas[revParse[1] ?? ""] ?? "unknown-sha"}\n`);
    const show = /^git show ([^:]+):(.+)$/.exec(line);
    if (show !== null) return FakeIo.show(atBase, show[2] ?? "");
    if (line.startsWith("git checkout --detach")) this.checkout(line, atBase);
    if (line.includes(" merge --no-edit ")) {
      return this.scenario.mergeConflicts === true
        ? Promise.resolve({ code: 1, stdout: "CONFLICT (content)", stderr: "" })
        : ok();
    }
    if (line === "git status --porcelain") return this.status();
    return undefined;
  }

  private static show(atBase: Map<string, string>, path: string): Promise<CommandResult> {
    const text = atBase.get(path);
    return text === undefined
      ? Promise.resolve({ code: 128, stdout: "", stderr: "fatal: path not in tree" })
      : ok(text);
  }

  private status(): Promise<CommandResult> {
    const changed = [...this.files].filter(([path, text]) => this.atCheckout.get(path) !== text);
    return ok(changed.map(([path]) => ` M ${path}\n`).join(""));
  }

  private checkout(line: string, atBase: Map<string, string>): void {
    if (
      line.startsWith("git checkout --detach origin/deps/") &&
      this.scenario.prHead !== undefined
    ) {
      this.files.set("package.json", rootManifest(this.scenario.prHead.catalog));
      this.files.set("bun.lock", lockfile(this.scenario.prHead.lock));
    }
    if (line === "git checkout --detach base-sha") this.files = new Map(atBase);
    this.atCheckout = new Map(this.files);
  }

  private bun(line: string): Promise<CommandResult> | undefined {
    if (line === "bun update -r --latest --ignore-scripts") {
      const latest = this.scenario.latest;
      if (latest !== undefined) {
        this.files.set("package.json", rootManifest(latest.catalog));
        this.files.set("bun.lock", lockfile(latest.lock));
      }
      return ok();
    }
    if (line === "bun install --ignore-scripts") {
      // Re-resolve restored specs: the lockfile follows the catalog's base versions.
      const catalog = (
        JSON.parse(this.files.get("package.json") ?? "{}") as {
          workspaces: { catalog: Record<string, string> };
        }
      ).workspaces.catalog;
      const lock = Object.fromEntries(
        Object.entries(catalog).map(([name, spec]) => [name, spec.replace(/^[\^~]/, "")]),
      );
      this.files.set("bun.lock", lockfile(lock));
      return ok();
    }
    if (line === "bun outdated -r") return ok(outdatedOutput);
    if (line.startsWith("bunx expo install --check")) {
      return Promise.resolve({
        code: 1,
        stdout: "expo-router@58.0.30 - expected version: ~58.0.32",
        stderr: "",
      });
    }
    return undefined;
  }

  private gh(line: string): Promise<CommandResult> | undefined {
    if (line.startsWith("gh pr list")) {
      return ok(JSON.stringify(this.scenario.openPr === undefined ? [] : [this.scenario.openPr]));
    }
    if (line.startsWith("gh pr create")) return ok("https://github.com/o/r/pull/9\n");
    return undefined;
  }

  readFile(path: string): Promise<string> {
    const text = this.files.get(path);
    return text === undefined ? Promise.reject(new Error(`ENOENT ${path}`)) : Promise.resolve(text);
  }

  writeFile(path: string, text: string): Promise<void> {
    this.files.set(path, text);
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  glob(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*/package.json", "");
    return Promise.resolve(
      [...this.files.keys()].filter(
        (path) => path.startsWith(prefix) && path.endsWith("/package.json"),
      ),
    );
  }

  fetchJson(url: string): Promise<unknown> {
    if (url.startsWith("https://api.github.com/repos/oven-sh/bun/releases")) {
      return Promise.resolve(
        this.scenario.bunReleases ?? [
          {
            tag_name: "bun-v1.4.4",
            published_at: "2026-10-22T10:11:32Z",
            prerelease: false,
            draft: false,
          },
        ],
      );
    }
    if (url === "https://nodejs.org/dist/index.json") {
      return Promise.resolve(
        this.scenario.nodeIndex ?? [{ version: "v26.13.1", date: "2026-11-10", lts: "Lithium" }],
      );
    }
    if (url === "https://registry.npmjs.org/oxlint") {
      return Promise.resolve({
        "dist-tags": { latest: "1.94.0" },
        time: { "1.94.0": "2026-11-17T12:26:37.473Z" },
      });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }

  log(line: string): void {
    this.logs.push(line);
  }
}

const options: FlowOptions = {
  dryRun: false,
  baseBranch: "main",
  now: NOW,
  label: "dependency-update",
  author: { name: "deps-bot", email: "deps-bot@example.invalid" },
};

const viteMajor = {
  catalog: {
    ...startCatalog,
    vite: "^9.0.1",
    effect: "4.1.5",
    react: "19.3.1",
    typescript: "~7.0.2",
  },
  lock: { ...startLock, vite: "9.0.1", effect: "4.1.5", react: "19.3.1", typescript: "7.0.2" },
};

function writes(io: FakeIo): string[] {
  return io.commands.filter((line) =>
    /^(git push|gh pr (create|edit|comment|close)|gh label)/.test(line),
  );
}

describe("runDependencyUpdate", () => {
  it("opens a labelled PR from main with the updates, restoring held packages", async () => {
    const io = new FakeIo({ latest: viteMajor });

    const outcome = await runDependencyUpdate(io, options);

    expect(io.commands).toContain("git checkout --detach base-sha");
    expect(io.commands).toContain("bun install --ignore-scripts");
    const catalog = (
      JSON.parse(io.files.get("package.json") ?? "") as {
        workspaces: { catalog: Record<string, string> };
      }
    ).workspaces.catalog;
    expect(catalog).toMatchObject({
      react: "19.3.0",
      typescript: "~6.0.3",
      vite: "^9.0.1",
      effect: "4.1.5",
    });
    expect(writes(io)).toEqual([
      "git push --force origin HEAD:refs/heads/deps/update-2026-11-19",
      "gh label create dependency-update --color 0366d6 --description Opened by the daily dependency-update workflow --force",
      "gh pr create --base main --head deps/update-2026-11-19 --title Dependency updates 2026-11-19 --label dependency-update --body-file -",
    ]);
    expect(outcome).toMatchObject({
      kind: "opened",
      url: "https://github.com/o/r/pull/9",
      branch: "deps/update-2026-11-19",
    });
    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain(
      "## Major\n\n| Package | From | To |\n| --- | --- | --- |\n| vite | 8.3.8 | 9.0.1 |",
    );
    expect(body).toContain("| effect | 4.1.4 | 4.1.5 |");
    expect(body).not.toContain("| react |");
    expect(body).toContain(
      "- react stays at 19.3.0 (newest allowed: 19.3.1): Owned by the Expo SDK.",
    );
    expect(body).toContain("| oxlint | 1.93.0 | 1.94.0 | 2026-11-17 |");
    expect(io.inputs.get(io.commands.find((line) => line.startsWith("gh pr create")) ?? "")).toBe(
      body,
    );
  });

  it("reports indirect dependencies that moved when no direct one did", async () => {
    const io = new FakeIo({
      latest: { catalog: startCatalog, lock: { ...startLock, isbot: "5.2.3" } },
    });
    io.files.set("bun.lock", lockfile({ ...startLock, isbot: "5.1.39" }));

    const outcome = await runDependencyUpdate(io, options);

    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain("No direct dependency changed.");
    expect(body).toContain("| isbot | 5.1.39 | 5.2.3 |");
  });

  it("commits as the configured author", async () => {
    const io = new FakeIo({ latest: viteMajor });

    await runDependencyUpdate(io, options);

    expect(io.commands).toContain(
      "git -c user.name=deps-bot -c user.email=deps-bot@example.invalid commit --quiet -m Update dependencies (2026-11-19)",
    );
  });

  it("builds on an open PR from an earlier day, then supersedes it", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    await runDependencyUpdate(io, options);

    expect(io.commands).toContain("git fetch --no-tags origin main deps/update-2026-11-18");
    expect(io.commands).toContain("git checkout --detach origin/deps/update-2026-11-18");
    expect(io.commands).toContain(
      "git -c user.name=deps-bot -c user.email=deps-bot@example.invalid merge --no-edit base-sha",
    );
    expect(writes(io).slice(-2)).toEqual([
      "gh pr comment 7 --body Superseded by https://github.com/o/r/pull/9.",
      "gh pr close 7 --delete-branch",
    ]);
  });

  it("starts again from main when merging main into the open PR conflicts, and says so", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      mergeConflicts: true,
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    const merge = io.commands.findIndex((line) => line.includes(" merge --no-edit "));
    expect(io.commands.slice(merge + 1, merge + 3)).toEqual([
      "git merge --abort",
      "git checkout --detach base-sha",
    ]);
    expect(outcome.kind === "unchanged" ? "" : outcome.body).toContain(
      "conflicted, so this update starts again from `main`",
    );
  });

  it("updates the open PR in place when it is already on today's branch", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPr: {
        number: 9,
        headRefName: "deps/update-2026-11-19",
        url: "https://github.com/o/r/pull/9",
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(writes(io)).toEqual([
      "git push --force-with-lease=refs/heads/deps/update-2026-11-19:origin/deps/update-2026-11-19 origin HEAD:refs/heads/deps/update-2026-11-19",
      "gh pr edit 9 --body-file -",
    ]);
    expect(outcome).toMatchObject({ kind: "updated", url: "https://github.com/o/r/pull/9" });
  });

  it("replaces today's branch with a lease when a merge conflict forced a fresh start", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      mergeConflicts: true,
      openPr: {
        number: 9,
        headRefName: "deps/update-2026-11-19",
        url: "https://github.com/o/r/pull/9",
      },
    });

    await runDependencyUpdate(io, options);

    expect(writes(io)).toEqual([
      "git push --force-with-lease=refs/heads/deps/update-2026-11-19:origin/deps/update-2026-11-19 origin HEAD:refs/heads/deps/update-2026-11-19",
      "gh pr edit 9 --body-file -",
    ]);
  });

  it("describes everything the PR changes against main, including updates carried from the open PR", async () => {
    const io = new FakeIo({
      prHead: {
        catalog: { ...startCatalog, vite: "^9.0.1" },
        lock: { ...startLock, vite: "9.0.1" },
      },
      latest: {
        catalog: { ...startCatalog, vite: "^9.0.1", effect: "4.1.5" },
        lock: { ...startLock, vite: "9.0.1", effect: "4.1.5" },
      },
      bunReleases: [
        {
          tag_name: "bun-v1.4.5",
          published_at: "2026-11-12T00:00:00Z",
          prerelease: false,
          draft: false,
        },
      ],
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain("| vite | 8.3.8 | 9.0.1 |");
    expect(body).toContain("| effect | 4.1.4 | 4.1.5 |");
    expect(body).toContain("- bun 1.4.4 → 1.4.5");
  });

  it("stops without committing, pushing or touching PRs when nothing changed", async () => {
    const io = new FakeIo({
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(io.commands.some((line) => line.includes(" commit "))).toBe(false);
    expect(writes(io)).toEqual([]);
  });

  it("moves bun and Node to the newest releases at least 3 days old and reports a newer LTS line", async () => {
    const io = new FakeIo({
      bunReleases: [
        {
          tag_name: "bun-v1.4.6",
          published_at: "2026-11-18T00:00:00Z",
          prerelease: false,
          draft: false,
        },
        {
          tag_name: "bun-v1.4.5",
          published_at: "2026-11-12T00:00:00Z",
          prerelease: false,
          draft: false,
        },
      ],
      nodeIndex: [
        { version: "v28.0.1", date: "2026-11-01", lts: "Next" },
        { version: "v26.13.2", date: "2026-11-12", lts: "Lithium" },
        { version: "v26.13.1", date: "2026-11-10", lts: "Lithium" },
      ],
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(io.files.get(".nvmrc")).toBe("26.13.2\n");
    expect(JSON.parse(io.files.get("package.json") ?? "")).toMatchObject({
      packageManager: "bun@1.4.5",
      engines: { bun: ">=1.4.5", node: ">=26.13.2" },
    });
    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain("- bun 1.4.4 → 1.4.5 (`packageManager` and `engines.bun`)");
    expect(body).toContain("- Node 26.13.1 → 26.13.2 (`.nvmrc` and `engines.node`)");
    expect(body).toContain("Node 28 is a newer LTS line. Moving to it is a manual change");
  });

  it("keeps @types/node on Node's major", async () => {
    const io = new FakeIo({
      latest: {
        catalog: { ...startCatalog, "@types/node": "^27.0.0" },
        lock: { ...startLock, "@types/node": "27.0.0" },
      },
    });
    io.files.set("package.json", rootManifest({ ...startCatalog, "@types/node": "^26.6.6" }));

    await runDependencyUpdate(io, options);

    expect(JSON.parse(io.files.get("package.json") ?? "")).toMatchObject({
      workspaces: { catalog: { "@types/node": "^26.6.6" } },
    });
  });

  it("reports Expo drift when the mobile app exists, and says it skipped the check when it does not", async () => {
    const withMobile = new FakeIo({ latest: viteMajor, mobileApp: true });
    const outcome = await runDependencyUpdate(withMobile, options);
    expect(withMobile.commands).toContain("bunx expo install --check");
    expect(outcome.kind === "unchanged" ? "" : outcome.body).toContain(
      "`expo install --check` in apps/mobile reports drift:\n\n  ```\n  expo-router@58.0.30 - expected version: ~58.0.32\n  ```",
    );

    const without = new FakeIo({ latest: viteMajor });
    await runDependencyUpdate(without, options);
    expect(without.commands.some((line) => line.startsWith("bunx expo"))).toBe(false);
    expect(without.logs).toContain(
      "apps/mobile does not exist, so there is no Expo version check.",
    );
  });

  it("in a dry run, logs the writes and the PR body instead of pushing or calling GitHub", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    const outcome = await runDependencyUpdate(io, { ...options, dryRun: true, startRef: "HEAD" });

    expect(writes(io)).toEqual([]);
    expect(io.commands).toContain(
      "git -c user.name=deps-bot -c user.email=deps-bot@example.invalid merge --no-edit caller-sha",
    );
    expect(io.logs).toContain(
      "Would run: git push --force origin HEAD:refs/heads/deps/update-2026-11-19",
    );
    expect(io.logs).toContain("Would run: gh pr close 7 --delete-branch");
    expect(outcome).toMatchObject({ kind: "opened", url: "(dry run: no PR opened)" });
    expect(io.logs.some((line) => line.includes("## Major"))).toBe(true);
  });

  it("resolves --from to a commit before checking anything out", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPr: {
        number: 7,
        headRefName: "deps/update-2026-11-18",
        url: "https://github.com/o/r/pull/7",
      },
    });

    await runDependencyUpdate(io, { ...options, dryRun: true, startRef: "HEAD" });

    const resolved = io.commands.indexOf("git rev-parse --verify HEAD^{commit}");
    const firstCheckout = io.commands.findIndex((line) => line.startsWith("git checkout"));
    expect(resolved).toBeGreaterThanOrEqual(0);
    expect(resolved).toBeLessThan(firstCheckout);
  });

  it("fails loudly when bun update fails", async () => {
    const io = new FakeIo({});
    const run = io.run.bind(io);
    io.run = (command, args, runOptions) =>
      command === "bun" && args[0] === "update"
        ? Promise.resolve({ code: 1, stdout: "", stderr: "error: resolution failed" })
        : run(command, args, runOptions);

    await expect(runDependencyUpdate(io, options)).rejects.toThrow(
      "bun update -r --latest --ignore-scripts failed (exit 1): error: resolution failed",
    );
  });
});
