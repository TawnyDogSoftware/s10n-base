import { describe, expect, it } from "vitest";

import { runDependencyUpdate, type CommandResult, type FlowOptions, type Io } from "./flow";
import { parseLockedVersions } from "./lockfile";
import { satisfies } from "./semver";

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

function webManifest(devDependencies?: Record<string, string>): string {
  const json = {
    name: "web",
    dependencies: { react: "catalog:" },
    ...(devDependencies === undefined ? {} : { devDependencies }),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
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

/** An open PR as `gh pr list --json` gives it; unset fields take the updater's own values. */
interface PrJson {
  readonly number: number;
  readonly headRefName: string;
  readonly url: string;
  readonly baseRefName?: string;
  readonly isCrossRepository?: boolean;
  readonly headRefOid?: string;
  readonly body?: string;
}

interface Scenario {
  readonly openPr?: PrJson;
  /** Every open labelled PR, when there is more than one. */
  readonly openPrs?: readonly PrJson[];
  readonly mergeConflicts?: boolean;
  /** Catalog and lockfile that `bun update -r --latest` produces. */
  readonly latest?: { catalog: Record<string, string>; lock: Record<string, string> };
  readonly bunReleases?: unknown[];
  readonly nodeIndex?: unknown[];
  readonly mobileApp?: boolean;
  /** Catalog and lockfile at the starting point, when they differ from the defaults below. */
  readonly start?: { catalog: Record<string, string>; lock: Record<string, string> };
  /** Catalog and lockfile on the open PR's branch, when it differs from main. */
  readonly prHead?: { catalog: Record<string, string>; lock: Record<string, string> };
  /** docker/Dockerfile at the start; none when unset. */
  readonly dockerfile?: string;
  /** Digests the registry knows, by `<repository>:<tag>`; any other tag answers 404. */
  readonly digests?: Record<string, string>;
  /** apps/web's own devDependencies at the start and after `bun update -r --latest`. */
  readonly webDev?: { start: Record<string, string>; latest: Record<string, string> };
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
    this.files.set("package.json", rootManifest(scenario.start?.catalog ?? startCatalog));
    this.files.set("apps/web/package.json", webManifest(scenario.webDev?.start));
    this.files.set("bun.lock", lockfile(scenario.start?.lock ?? startLock));
    this.files.set(".nvmrc", "26.13.1\n");
    this.files.set("dependency-holds.json", holdsFile);
    if (scenario.mobileApp === true) this.files.set("apps/mobile/package.json", "{}");
    if (scenario.dockerfile !== undefined) this.files.set("docker/Dockerfile", scenario.dockerfile);
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
      const webDev = this.scenario.webDev;
      if (webDev !== undefined) this.files.set("apps/web/package.json", webManifest(webDev.latest));
      return ok();
    }
    if (line === "bun install --ignore-scripts") {
      // As bun does: a locked version that still satisfies its spec stays; otherwise the
      // package resolves again, here to the spec's own version.
      const catalog = (
        JSON.parse(this.files.get("package.json") ?? "{}") as {
          workspaces: { catalog: Record<string, string> };
        }
      ).workspaces.catalog;
      const locked = parseLockedVersions(this.files.get("bun.lock") ?? "");
      const lock = Object.fromEntries(
        Object.entries(catalog).map(([name, spec]) => {
          const current = locked.get(name);
          const keep = current !== undefined && satisfies(current, spec);
          return [name, keep ? current : spec.replace(/^[\^~]/, "")];
        }),
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
      const { openPr, openPrs = openPr === undefined ? [] : [openPr] } = this.scenario;
      return ok(
        JSON.stringify(
          openPrs.map((pr) =>
            Object.assign(
              {
                baseRefName: "main",
                isCrossRepository: false,
                headRefOid: "pr-head-sha",
                body: "",
              },
              pr,
            ),
          ),
        ),
      );
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
    if (url.startsWith("https://auth.docker.io/token?")) {
      return Promise.resolve({ token: "registry-token" });
    }
    if (url === "https://registry.npmjs.org/oxlint") {
      return Promise.resolve({
        "dist-tags": { latest: "1.94.0" },
        time: { "1.94.0": "2026-11-17T12:26:37.473Z" },
      });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }

  fetchHeaders(url: string): Promise<Readonly<Record<string, string>>> {
    this.commands.push(`HEAD ${url}`);
    const match = /^https:\/\/registry-1\.docker\.io\/v2\/(.+)\/manifests\/(.+)$/.exec(url);
    const digest = this.scenario.digests?.[`${match?.[1] ?? ""}:${match?.[2] ?? ""}`];
    return digest === undefined
      ? Promise.reject(new Error(`HEAD ${url} answered 404`))
      : Promise.resolve({ "docker-content-digest": digest });
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

function withoutOxlint(versions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(versions).filter(([name]) => name !== "oxlint"));
}

function writes(io: FakeIo): string[] {
  return io.commands.filter((line) =>
    /^(git push|gh pr (create|edit|comment|close)|gh label)/.test(line),
  );
}

describe("runDependencyUpdate", () => {
  it("keeps a held package's locked version when the update moved it inside its range", async () => {
    // bun update --latest moves react from 19.3.0 to 19.3.1. Putting the spec back to ~19.3.0
    // alone would leave 19.3.1 locked, since it satisfies the range.
    const io = new FakeIo({
      start: { catalog: { ...startCatalog, react: "~19.3.0" }, lock: startLock },
      latest: {
        catalog: { ...startCatalog, react: "~19.3.1", effect: "4.1.5" },
        lock: { ...startLock, react: "19.3.1", effect: "4.1.5" },
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    const locked = parseLockedVersions(io.files.get("bun.lock") ?? "");
    expect(locked.get("react")).toBe("19.3.0");
    expect(locked.get("effect")).toBe("4.1.5");
    expect(io.files.get("package.json")).toContain('"react": "~19.3.0"');
    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain("react stays at ~19.3.0");
    expect(body).not.toMatch(/react\s*\|\s*19\.3\.0\s*\|\s*19\.3\.1/);
  });

  it("puts a range-held package moved past its range back to its spec without pinning it", async () => {
    // Only the spec goes back, in one install, so bun resolves the package again inside it.
    // Checked with bun 1.4.4 (plan 011, F49): kysely held to 0.28.x at ^0.28.5, moved by
    // `bun update --latest` to ^0.29.9, then given ^0.28.5 back, locked 0.28.20, the newest
    // 0.28 release old enough for the age gate (0.28.19 with a 10-day gate).
    const io = new FakeIo({
      latest: {
        catalog: { ...startCatalog, typescript: "~7.0.2", effect: "4.1.5" },
        lock: { ...startLock, typescript: "7.0.2", effect: "4.1.5" },
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(io.commands.filter((line) => line === "bun install --ignore-scripts")).toHaveLength(1);
    expect(io.files.get("package.json")).toContain('"typescript": "~6.0.3"');
    expect(parseLockedVersions(io.files.get("bun.lock") ?? "").get("typescript")).toBe("6.0.3");
    expect(outcome.kind === "unchanged" ? "" : outcome.body).toContain(
      "typescript stays at ~6.0.3",
    );
  });

  it("checks and restores each declaration of a held package at its own place", async () => {
    // typescript is in the catalog and, with another spec, in apps/web. Both leave the range;
    // each must get its own spec back, not the spec of whichever declaration was read last.
    const io = new FakeIo({
      latest: {
        catalog: { ...startCatalog, typescript: "~7.0.2", effect: "4.1.5" },
        lock: { ...startLock, typescript: "7.0.2", effect: "4.1.5" },
      },
      webDev: { start: { typescript: "~6.0.1" }, latest: { typescript: "^7.0.2" } },
    });

    await runDependencyUpdate(io, options);

    expect(io.files.get("package.json")).toContain('"typescript": "~6.0.3"');
    expect(io.files.get("apps/web/package.json")).toContain('"typescript": "~6.0.1"');
  });

  it("restores a declaration that left a range even when another declaration stayed in it", async () => {
    const io = new FakeIo({
      latest: {
        catalog: { ...startCatalog, typescript: "~7.0.2", effect: "4.1.5" },
        lock: { ...startLock, typescript: "7.0.2", effect: "4.1.5" },
      },
      webDev: { start: { typescript: "~6.0.1" }, latest: { typescript: "~6.0.3" } },
    });

    await runDependencyUpdate(io, options);

    expect(io.files.get("package.json")).toContain('"typescript": "~6.0.3"');
    expect(io.files.get("apps/web/package.json")).toContain('"typescript": "~6.0.3"');
  });

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
    expect(body).toContain("- react stays at 19.3.0, not 19.3.1: Owned by the Expo SDK.");
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

  it("lists packages added to or removed from bun.lock, direct and indirect", async () => {
    const io = new FakeIo({
      latest: {
        catalog: { ...withoutOxlint(startCatalog), zod: "^4.0.0" },
        lock: { ...withoutOxlint(startLock), zod: "4.0.0", "new-dep": "2.0.0" },
      },
    });
    io.files.set("bun.lock", lockfile({ ...startLock, "old-dep": "1.0.0" }));

    const outcome = await runDependencyUpdate(io, options);

    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain(
      "## Added and removed\n\n| Package | From | To |\n| --- | --- | --- |\n| oxlint | 1.93.0 | (none) |\n| zod | (none) | 4.0.0 |",
    );
    expect(body).toContain("| new-dep | (none) | 2.0.0 |");
    expect(body).toContain("| old-dep | 1.0.0 | (none) |");
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

  it("leaves a labelled PR alone unless it is on a dated update branch into the base branch", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPrs: [
        { number: 12, headRefName: "feature/login", url: "https://github.com/o/r/pull/12" },
        {
          number: 11,
          headRefName: "deps/update-2026-11-18",
          baseRefName: "release",
          url: "https://github.com/o/r/pull/11",
        },
        {
          number: 10,
          headRefName: "deps/update-2026-11-18",
          isCrossRepository: true,
          url: "https://github.com/o/r/pull/10",
        },
      ],
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(io.commands).toContain("git checkout --detach base-sha");
    expect(io.commands.some((line) => line.includes("feature/login"))).toBe(false);
    expect(writes(io).filter((line) => /^gh pr (close|comment|edit)/.test(line))).toEqual([]);
    expect(outcome).toMatchObject({ kind: "opened" });
    expect(io.logs).toContain(
      "Leaving PR #12 alone: it has the dependency-update label but is not the updater's (head feature/login into main).",
    );
  });

  it("closes every older update PR when it opens a new one", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      openPrs: [
        { number: 5, headRefName: "deps/update-2026-11-17", url: "https://github.com/o/r/pull/5" },
        { number: 7, headRefName: "deps/update-2026-11-18", url: "https://github.com/o/r/pull/7" },
      ],
    });

    await runDependencyUpdate(io, options);

    expect(io.commands).toContain("git checkout --detach origin/deps/update-2026-11-18");
    expect(writes(io).slice(-4)).toEqual([
      "gh pr comment 7 --body Superseded by https://github.com/o/r/pull/9.",
      "gh pr close 7 --delete-branch",
      "gh pr comment 5 --body Superseded by https://github.com/o/r/pull/9.",
      "gh pr close 5 --delete-branch",
    ]);
  });

  it("closes an older update PR a failed run left open, even when nothing changed", async () => {
    const io = new FakeIo({
      openPrs: [
        { number: 9, headRefName: "deps/update-2026-11-19", url: "https://github.com/o/r/pull/9" },
        { number: 7, headRefName: "deps/update-2026-11-18", url: "https://github.com/o/r/pull/7" },
      ],
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(writes(io)).toEqual([
      "gh pr comment 7 --body Superseded by https://github.com/o/r/pull/9.",
      "gh pr close 7 --delete-branch",
    ]);
  });

  it("records the commit a body describes, and repairs a body left describing an older one", async () => {
    // The first run pushed and then failed to edit the body; the rerun finds no file change.
    const prHead = {
      catalog: { ...startCatalog, vite: "^9.0.1" },
      lock: { ...startLock, vite: "9.0.1" },
    };
    const io = new FakeIo({
      prHead,
      openPr: {
        number: 9,
        headRefName: "deps/update-2026-11-19",
        url: "https://github.com/o/r/pull/9",
        headRefOid: "pushed-sha",
        body: "Older contents.\n\n<!-- dependency-update head: earlier-sha -->\n",
      },
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(writes(io)).toEqual(["gh pr edit 9 --body-file -"]);
    const body = io.inputs.get("gh pr edit 9 --body-file -") ?? "";
    expect(body).toContain("| vite | 8.3.8 | 9.0.1 |");
    expect(body).toMatch(/<!-- dependency-update head: pushed-sha -->\n$/);
    expect(outcome).toMatchObject({ kind: "updated", url: "https://github.com/o/r/pull/9", body });
  });

  it("leaves the body alone when it describes the PR's head or names no commit", async () => {
    for (const body of [
      "Edited by hand.\n",
      "Contents.\n\n<!-- dependency-update head: pr-head-sha -->\n",
    ]) {
      const io = new FakeIo({
        openPr: {
          number: 9,
          headRefName: "deps/update-2026-11-19",
          url: "https://github.com/o/r/pull/9",
          body,
        },
      });

      expect(await runDependencyUpdate(io, options)).toEqual({ kind: "unchanged" });
      expect(writes(io)).toEqual([]);
    }
  });

  it("ends the body with the commit it describes", async () => {
    const io = new FakeIo({ latest: viteMajor });

    const outcome = await runDependencyUpdate(io, options);

    expect(outcome.kind === "unchanged" ? "" : outcome.body).toMatch(
      /\n\n<!-- dependency-update head: caller-sha -->\n$/,
    );
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

  describe("with a Dockerfile", () => {
    const OLD_NODE = `sha256:${"1".repeat(64)}`;
    const OLD_BUN = `sha256:${"2".repeat(64)}`;
    const NEW_NODE = `sha256:${"3".repeat(64)}`;
    const NEW_BUN = `sha256:${"4".repeat(64)}`;
    const dockerfile = [
      `FROM oven/bun:1.4.4-slim@${OLD_BUN} AS bun`,
      `FROM node:26.13.1-trixie-slim@${OLD_NODE} AS toolchain`,
      'RUN test "$(node --version)" = "v26.13.1" && test "$(bun --version)" = "1.4.4"',
      `FROM node:26.13.1-trixie-slim@${OLD_NODE} AS runtime`,
      "",
    ].join("\n");
    const releases = {
      bunReleases: [
        {
          tag_name: "bun-v1.4.5",
          published_at: "2026-11-12T00:00:00Z",
          prerelease: false,
          draft: false,
        },
      ],
      nodeIndex: [{ version: "v26.13.2", date: "2026-11-12", lts: "Lithium" }],
    };

    it("moves both images to the new tags, pinned to the digests the registry gives", async () => {
      const io = new FakeIo({
        ...releases,
        dockerfile,
        digests: { "library/node:26.13.2-trixie-slim": NEW_NODE, "oven/bun:1.4.5-slim": NEW_BUN },
      });

      const outcome = await runDependencyUpdate(io, options);

      expect(io.files.get("docker/Dockerfile")).toBe(
        dockerfile
          .replaceAll(
            `node:26.13.1-trixie-slim@${OLD_NODE}`,
            `node:26.13.2-trixie-slim@${NEW_NODE}`,
          )
          .replace(`oven/bun:1.4.4-slim@${OLD_BUN}`, `oven/bun:1.4.5-slim@${NEW_BUN}`)
          .replace('"v26.13.1"', '"v26.13.2"')
          .replace('= "1.4.4"', '= "1.4.5"'),
      );
      expect(io.commands).toContain(
        "HEAD https://registry-1.docker.io/v2/library/node/manifests/26.13.2-trixie-slim",
      );
      expect(io.logs).toContain(`Resolved node:26.13.2-trixie-slim to ${NEW_NODE}.`);
      const body = outcome.kind === "unchanged" ? "" : outcome.body;
      expect(body).toContain(
        "- Node 26.13.1 → 26.13.2 (`.nvmrc`, `engines.node` and the image in `docker/Dockerfile`)",
      );
      expect(body).toContain(
        "- bun 1.4.4 → 1.4.5 (`packageManager`, `engines.bun` and the image in `docker/Dockerfile`)",
      );
    });

    it("leaves a runtime where it is when its image cannot be resolved, and says why", async () => {
      const io = new FakeIo({
        ...releases,
        dockerfile,
        digests: { "oven/bun:1.4.5-slim": NEW_BUN },
      });

      const outcome = await runDependencyUpdate(io, options);

      expect(io.files.get(".nvmrc")).toBe("26.13.1\n");
      expect(JSON.parse(io.files.get("package.json") ?? "")).toMatchObject({
        packageManager: "bun@1.4.5",
        engines: { node: ">=26.13.1" },
      });
      expect(io.files.get("docker/Dockerfile")).toContain(`node:26.13.1-trixie-slim@${OLD_NODE}`);
      expect(io.files.get("docker/Dockerfile")).toContain(`oven/bun:1.4.5-slim@${NEW_BUN}`);
      const body = outcome.kind === "unchanged" ? "" : outcome.body;
      expect(body).toContain(
        "Node 26.13.2 is not applied: the image node:26.13.2-trixie-slim could not be resolved (HEAD https://registry-1.docker.io/v2/library/node/manifests/26.13.2-trixie-slim answered 404).",
      );
    });

    it("moves each stage with its own variant and that variant's digest", async () => {
      const ALPINE = `sha256:${"5".repeat(64)}`;
      const NEW_ALPINE = `sha256:${"6".repeat(64)}`;
      const twoVariants = dockerfile.replace(
        `FROM node:26.13.1-trixie-slim@${OLD_NODE} AS runtime`,
        `FROM node:26.13.1-alpine@${ALPINE} AS runtime`,
      );
      const io = new FakeIo({
        ...releases,
        dockerfile: twoVariants,
        digests: {
          "library/node:26.13.2-trixie-slim": NEW_NODE,
          "library/node:26.13.2-alpine": NEW_ALPINE,
          "oven/bun:1.4.5-slim": NEW_BUN,
        },
      });

      await runDependencyUpdate(io, options);

      const moved = io.files.get("docker/Dockerfile") ?? "";
      expect(moved).toContain(`FROM node:26.13.2-trixie-slim@${NEW_NODE} AS toolchain`);
      expect(moved).toContain(`FROM node:26.13.2-alpine@${NEW_ALPINE} AS runtime`);
    });

    it("leaves a runtime alone when the tag of any one of its variants cannot be resolved", async () => {
      const ALPINE = `sha256:${"5".repeat(64)}`;
      const twoVariants = dockerfile.replace(
        `FROM node:26.13.1-trixie-slim@${OLD_NODE} AS runtime`,
        `FROM node:26.13.1-alpine@${ALPINE} AS runtime`,
      );
      const io = new FakeIo({
        ...releases,
        dockerfile: twoVariants,
        digests: { "library/node:26.13.2-trixie-slim": NEW_NODE, "oven/bun:1.4.5-slim": NEW_BUN },
      });

      const outcome = await runDependencyUpdate(io, options);

      expect(io.files.get(".nvmrc")).toBe("26.13.1\n");
      expect(io.files.get("docker/Dockerfile")).toContain(`node:26.13.1-trixie-slim@${OLD_NODE}`);
      expect(io.files.get("docker/Dockerfile")).toContain(`node:26.13.1-alpine@${ALPINE}`);
      expect(outcome.kind === "unchanged" ? "" : outcome.body).toContain(
        "Node 26.13.2 is not applied: the image node:26.13.2-alpine could not be resolved",
      );
    });

    it("looks nothing up when neither runtime moves", async () => {
      const io = new FakeIo({ dockerfile });

      await runDependencyUpdate(io, options);

      expect(io.commands.filter((line) => line.startsWith("HEAD "))).toEqual([]);
      expect(io.files.get("docker/Dockerfile")).toBe(dockerfile);
    });
  });

  it("says so when no bun release on the page GitHub returns is old enough", async () => {
    const io = new FakeIo({
      latest: viteMajor,
      bunReleases: [
        {
          tag_name: "bun-v1.4.6",
          published_at: "2026-11-18T00:00:00Z",
          prerelease: false,
          draft: false,
        },
      ],
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(outcome.kind === "unchanged" ? "" : outcome.body).toContain(
      "bun is not checked: none of the newest 30 bun releases on GitHub is a stable release at least 3 days old.",
    );
  });

  it("moves Node alone when bun has no newer release", async () => {
    const io = new FakeIo({
      nodeIndex: [{ version: "v26.13.2", date: "2026-11-12", lts: "Lithium" }],
    });

    const outcome = await runDependencyUpdate(io, options);

    expect(JSON.parse(io.files.get("package.json") ?? "")).toMatchObject({
      packageManager: "bun@1.4.4",
      engines: { bun: ">=1.4.4", node: ">=26.13.2" },
    });
    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).not.toContain("- bun ");
  });

  it("names the spec it refused when a held package was moved to something that is not a version", async () => {
    const io = new FakeIo({
      latest: { catalog: { ...startCatalog, react: "canary" }, lock: startLock },
    });
    io.files.set("bun.lock", lockfile({ ...startLock, isbot: "5.1.39" }));

    const outcome = await runDependencyUpdate(io, {
      ...options,
      now: new Date("2026-11-20T00:10:00Z"),
    });

    const body = outcome.kind === "unchanged" ? "" : outcome.body;
    expect(body).toContain("- react stays at 19.3.0, not canary: Owned by the Expo SDK.");
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
