/**
 * The daily dependency update, written against an injected `Io` so the whole flow can
 * be tested without git, bun, GitHub or the network. `run.ts` supplies the real `Io`.
 */
import { enforceHolds, parseHolds, type Hold, type Restoration } from "./holds";
import { parseLockedVersions } from "./lockfile";
import {
  applySpecs,
  collectSpecs,
  formatManifest,
  setRuntimeVersions,
  type Manifest,
  type ManifestFile,
} from "./manifests";
import { parseOutdated } from "./outdated";
import {
  buildPrBody,
  type AgeHeldPackage,
  type IndirectChange,
  type RuntimeChange,
  type VersionChange,
} from "./pr-body";
import {
  pickBunRelease,
  pickNodeRelease,
  type GitHubRelease,
  type NodeIndexEntry,
} from "./releases";
import { classifyChange, compareVersions, specBaseVersion } from "./semver";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Io {
  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string; readonly input?: string },
  ): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Paths matching a pattern such as `apps/*\/package.json`, relative to the repo root. */
  glob(pattern: string): Promise<string[]>;
  fetchJson(url: string): Promise<unknown>;
  log(line: string): void;
}

export interface FlowOptions {
  readonly dryRun: boolean;
  /** The branch update PRs target. */
  readonly baseBranch: string;
  /** Start from this ref instead of `origin/<baseBranch>`, for a dry run of a branch. */
  readonly startRef?: string;
  readonly now: Date;
  readonly label: string;
  readonly author: { readonly name: string; readonly email: string };
}

export type FlowOutcome =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "opened" | "updated";
      readonly branch: string;
      readonly url: string;
      readonly body: string;
    };

interface OpenPr {
  readonly number: number;
  readonly headRefName: string;
  readonly url: string;
}

const BUN_RELEASES_URL = "https://api.github.com/repos/oven-sh/bun/releases?per_page=30";
const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const DRY_RUN_URL = "(dry run: no PR opened)";

async function mustRun(
  io: Io,
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly input?: string },
): Promise<CommandResult> {
  const result = await io.run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 2_000);
    throw new Error(`${[command, ...args].join(" ")} failed (exit ${result.code}): ${detail}`);
  }
  return result;
}

async function readManifests(io: Io): Promise<ManifestFile[]> {
  const root = JSON.parse(await io.readFile("package.json")) as Manifest;
  const workspaces = root.workspaces;
  const patterns =
    typeof workspaces === "object" &&
    workspaces !== null &&
    "packages" in workspaces &&
    Array.isArray(workspaces.packages)
      ? (workspaces.packages as unknown[]).filter(
          (pattern): pattern is string => typeof pattern === "string",
        )
      : [];
  const paths = (await Promise.all(patterns.map((pattern) => io.glob(`${pattern}/package.json`))))
    .flat()
    .sort();
  const files: ManifestFile[] = [{ path: "package.json", json: root }];
  for (const path of paths) {
    files.push({ path, json: JSON.parse(await io.readFile(path)) as Manifest });
  }
  return files;
}

async function findOpenPr(io: Io, label: string): Promise<OpenPr | undefined> {
  const result = await mustRun(io, "gh", [
    "pr",
    "list",
    "--label",
    label,
    "--state",
    "open",
    "--json",
    "number,headRefName,url",
  ]);
  const prs = JSON.parse(result.stdout) as OpenPr[];
  return prs.sort((a, b) => b.number - a.number)[0];
}

/** Checks out the starting point; returns true when a merge conflict forced a fresh start. */
async function checkoutStart(
  io: Io,
  options: FlowOptions,
  openPr: OpenPr | undefined,
): Promise<boolean> {
  const fetchRefs = [options.baseBranch, ...(openPr === undefined ? [] : [openPr.headRefName])];
  await mustRun(io, "git", ["fetch", "--no-tags", "origin", ...fetchRefs]);
  const baseRef = options.startRef ?? `origin/${options.baseBranch}`;
  if (openPr === undefined) {
    await mustRun(io, "git", ["checkout", "--detach", baseRef]);
    return false;
  }
  await mustRun(io, "git", ["checkout", "--detach", `origin/${openPr.headRefName}`]);
  const merge = await io.run("git", [...authorArgs(options), "merge", "--no-edit", baseRef]);
  if (merge.code === 0) return false;
  io.log(
    `Merging ${baseRef} into ${openPr.headRefName} conflicted; starting again from ${baseRef}.`,
  );
  await mustRun(io, "git", ["merge", "--abort"]);
  await mustRun(io, "git", ["checkout", "--detach", baseRef]);
  return true;
}

function authorArgs(options: FlowOptions): string[] {
  return ["-c", `user.name=${options.author.name}`, "-c", `user.email=${options.author.email}`];
}

async function updatePackages(
  io: Io,
  holds: readonly Hold[],
  nodeMajor: string,
): Promise<Restoration[]> {
  const before = collectSpecs(await readManifests(io));
  await mustRun(io, "bun", ["update", "-r", "--latest", "--ignore-scripts"]);
  const updated = await readManifests(io);
  const typesNodeHold: Hold = {
    packages: ["@types/node"],
    range: `^${nodeMajor}.0.0`,
    reason: `Kept on Node's major version (${nodeMajor}).`,
  };
  const restorations = enforceHolds([...holds, typesNodeHold], before, collectSpecs(updated));
  if (restorations.length > 0) {
    const restored = new Map(
      restorations.map((restoration) => [restoration.name, restoration.restoredTo]),
    );
    for (const file of applySpecs(updated, restored)) {
      await io.writeFile(file.path, formatManifest(file.json));
    }
    await mustRun(io, "bun", ["install", "--ignore-scripts"]);
  }
  return restorations;
}

async function updateRuntimes(
  io: Io,
  now: Date,
): Promise<{ runtimes: RuntimeChange[]; notApplied: string[] }> {
  const root = JSON.parse(await io.readFile("package.json")) as Manifest;
  const currentNode = (await io.readFile(".nvmrc")).trim();
  const currentBun = String(root.packageManager ?? "").replace(/^bun@/, "");
  const runtimes: RuntimeChange[] = [];
  const notApplied: string[] = [];

  const bun = pickBunRelease((await io.fetchJson(BUN_RELEASES_URL)) as GitHubRelease[], now);
  const nodeMajor = Number(currentNode.split(".")[0]);
  const node = pickNodeRelease(
    (await io.fetchJson(NODE_INDEX_URL)) as NodeIndexEntry[],
    nodeMajor,
    now,
  );

  const newBun = bun !== undefined && compareVersions(bun, currentBun) > 0 ? bun : undefined;
  const newNode =
    node.version !== undefined && compareVersions(node.version, currentNode) > 0
      ? node.version
      : undefined;
  if (newBun !== undefined) {
    runtimes.push({
      name: "bun",
      from: currentBun,
      to: newBun,
      files: "`packageManager` and `engines.bun`",
    });
  }
  if (newNode !== undefined) {
    runtimes.push({
      name: "Node",
      from: currentNode,
      to: newNode,
      files: "`.nvmrc` and `engines.node`",
    });
    await io.writeFile(".nvmrc", `${newNode}\n`);
  }
  if (newBun !== undefined || newNode !== undefined) {
    const versions = {
      ...(newBun === undefined ? {} : { bun: newBun }),
      ...(newNode === undefined ? {} : { node: newNode }),
    };
    await io.writeFile("package.json", formatManifest(setRuntimeVersions(root, versions)));
  }
  if (node.newerLtsMajor !== undefined) {
    notApplied.push(
      `Node ${node.newerLtsMajor} is a newer LTS line. Moving to it is a manual change: it also moves \`@types/node\` to that major and any Docker base image.`,
    );
  }
  return { runtimes, notApplied };
}

async function checkExpo(io: Io): Promise<string[]> {
  if (!(await io.exists("apps/mobile/package.json"))) {
    io.log("apps/mobile does not exist, so there is no Expo version check.");
    return [];
  }
  const result = await io.run("bunx", ["expo", "install", "--check"], { cwd: "apps/mobile" });
  if (result.code === 0) return [];
  const output = `${result.stdout}\n${result.stderr}`
    .trim()
    .split("\n")
    .map((line) => `  ${line}`);
  return [
    `\`expo install --check\` in apps/mobile reports drift:\n\n  \`\`\`\n${output.join("\n")}\n  \`\`\``,
  ];
}

async function packagesHeldByAge(io: Io): Promise<AgeHeldPackage[]> {
  const result = await io.run("bun", ["outdated", "-r"]);
  const rows = parseOutdated(result.stdout).filter((row) => row.heldByAge);
  const unique = [...new Map(rows.map((row) => [row.name, row])).values()];
  return Promise.all(
    unique.map(async (row) => {
      try {
        const doc = (await io.fetchJson(
          `https://registry.npmjs.org/${row.name.replace("/", "%2f")}`,
        )) as {
          "dist-tags"?: { latest?: string };
          time?: Record<string, string>;
        };
        const newest = doc["dist-tags"]?.latest;
        const publishedAt = newest === undefined ? undefined : doc.time?.[newest];
        return {
          name: row.name,
          current: row.current,
          ...(newest === undefined ? {} : { newest }),
          ...(publishedAt === undefined ? {} : { publishedAt }),
        };
      } catch {
        return { name: row.name, current: row.current };
      }
    }),
  );
}

function versionChanges(
  names: Iterable<string>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): VersionChange[] {
  return [...new Set(names)].flatMap((name) => {
    const from = before.get(name);
    const to = after.get(name);
    if (from === undefined || to === undefined || from === to) return [];
    if (specBaseVersion(from) === undefined || specBaseVersion(to) === undefined) return [];
    return [{ name, from, to, kind: classifyChange(from, to) }];
  });
}

function indirectChanges(
  direct: ReadonlySet<string>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): IndirectChange[] {
  return [...after].flatMap(([name, to]) => {
    const from = before.get(name);
    return direct.has(name) || from === undefined || from === to ? [] : [{ name, from, to }];
  });
}

export async function runDependencyUpdate(io: Io, options: FlowOptions): Promise<FlowOutcome> {
  const date = options.now.toISOString().slice(0, 10);
  const branch = `deps/update-${date}`;
  const write = async (
    command: string,
    args: readonly string[],
    input?: string,
  ): Promise<CommandResult> => {
    if (options.dryRun) {
      io.log(`Would run: ${[command, ...args].join(" ")}`);
      return { code: 0, stdout: DRY_RUN_URL, stderr: "" };
    }
    return mustRun(io, command, args, input === undefined ? undefined : { input });
  };

  const openPr = await findOpenPr(io, options.label);
  io.log(
    openPr === undefined
      ? "No open dependency-update PR."
      : `Open dependency-update PR: ${openPr.url}`,
  );
  const freshStart = await checkoutStart(io, options, openPr);

  const holds = parseHolds(JSON.parse(await io.readFile("dependency-holds.json")) as unknown);
  const nodeMajor = (await io.readFile(".nvmrc")).trim().split(".")[0] ?? "";
  const lockedBefore = parseLockedVersions(await io.readFile("bun.lock"));
  const declaredBefore = collectSpecs(await readManifests(io));

  const restorations = await updatePackages(io, holds, nodeMajor);
  const { runtimes, notApplied } = await updateRuntimes(io, options.now);
  const expoNotes = await checkExpo(io);
  const heldByAge = await packagesHeldByAge(io);

  const status = await mustRun(io, "git", ["status", "--porcelain"]);
  if (status.stdout.trim() === "") {
    io.log("Nothing to update: no file changed on top of the starting point.");
    return { kind: "unchanged" };
  }

  const lockedAfter = parseLockedVersions(await io.readFile("bun.lock"));
  const declaredAfter = collectSpecs(await readManifests(io));
  const direct = new Set([...declaredBefore.keys(), ...declaredAfter.keys()]);
  const body = buildPrBody({
    date,
    baseBranch: options.baseBranch,
    freshStart,
    changes: versionChanges(direct, lockedBefore, lockedAfter),
    indirect: indirectChanges(direct, lockedBefore, lockedAfter),
    runtimes,
    notApplied: [
      ...restorations.map(
        (restoration) =>
          `${restoration.name} stays at ${restoration.restoredTo} (newest allowed: ${specBaseVersion(restoration.attempted) ?? restoration.attempted}): ${restoration.reason}`,
      ),
      ...notApplied,
      ...expoNotes,
    ],
    heldByAge,
  });

  await mustRun(io, "git", ["add", "--all"]);
  await mustRun(io, "git", [
    ...authorArgs(options),
    "commit",
    "--quiet",
    "-m",
    `Update dependencies (${date})`,
  ]);

  let outcome: FlowOutcome;
  if (openPr?.headRefName === branch) {
    await write("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
    await write("gh", ["pr", "edit", String(openPr.number), "--body-file", "-"], body);
    outcome = { kind: "updated", branch, url: openPr.url, body };
  } else {
    await write("git", ["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);
    await write("gh", [
      "label",
      "create",
      options.label,
      "--color",
      "0366d6",
      "--description",
      "Opened by the daily dependency-update workflow",
      "--force",
    ]);
    const created = await write(
      "gh",
      [
        "pr",
        "create",
        "--base",
        options.baseBranch,
        "--head",
        branch,
        "--title",
        `Dependency updates ${date}`,
        "--label",
        options.label,
        "--body-file",
        "-",
      ],
      body,
    );
    const url = created.stdout.trim();
    if (openPr !== undefined) {
      await write("gh", [
        "pr",
        "comment",
        String(openPr.number),
        "--body",
        `Superseded by ${url}.`,
      ]);
      await write("gh", ["pr", "close", String(openPr.number), "--delete-branch"]);
    }
    outcome = { kind: "opened", branch, url, body };
  }

  if (options.dryRun) {
    io.log("PR body:");
    io.log(body);
  }
  return outcome;
}
