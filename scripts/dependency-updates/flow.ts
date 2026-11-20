/**
 * The daily dependency update, written against an injected `Io` so the whole flow can
 * be tested without git, bun, GitHub or the network. `run.ts` supplies the real `Io`.
 */
import {
  DOCKERFILE,
  moveRuntime,
  RUNTIME_IMAGES,
  type Runtime,
  tagFor,
} from "../dockerfile-versions";
import { enforceHolds, parseHolds, type Hold, type Restoration } from "./holds";
import { resolveImageDigest, type RegistryIo } from "./image-digests";
import { parseLockedVersions } from "./lockfile";
import {
  applyDeclarations,
  collectDeclarations,
  collectSpecs,
  formatManifest,
  setRuntimeVersions,
  type Declaration,
  type Manifest,
  type ManifestFile,
} from "./manifests";
import { parseOutdated, type OutdatedRow } from "./outdated";
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

export interface Io extends RegistryIo {
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

interface Published {
  readonly kind: "opened" | "updated";
  readonly branch: string;
  readonly url: string;
  readonly body: string;
}

export type FlowOutcome = { readonly kind: "unchanged" } | Published;

interface OpenPr {
  readonly number: number;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly isCrossRepository: boolean;
  readonly headRefOid: string;
  readonly body: string;
  readonly url: string;
}

/** The branches the updater pushes: `deps/update-YYYY-MM-DD`. */
const UPDATE_BRANCH = /^deps\/update-\d{4}-\d{2}-\d{2}$/;

const BUN_RELEASES_PAGE = 30;
const BUN_RELEASES_URL = `https://api.github.com/repos/oven-sh/bun/releases?per_page=${String(BUN_RELEASES_PAGE)}`;
const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const DRY_RUN_URL = "(dry run: no PR opened)";

export async function mustRun(
  io: Io,
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string; readonly input?: string },
): Promise<CommandResult> {
  const result = await io.run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 2_000);
    throw new Error(
      `${[command, ...args].join(" ")} failed (exit ${String(result.code)}): ${detail}`,
    );
  }
  return result;
}

export async function readManifests(io: Io): Promise<ManifestFile[]> {
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
    .toSorted((left, right) => left.localeCompare(right));
  const workspaceFiles = await Promise.all(
    paths.map(async (path) => ({ path, json: JSON.parse(await io.readFile(path)) as Manifest })),
  );
  return [{ path: "package.json", json: root }, ...workspaceFiles];
}

/**
 * The updater's open PRs, newest first. A PR counts only with the label, a head branch of this
 * repository named like the updater's, and the base branch as its base; any other labelled PR
 * is logged and left alone, so a label put on the wrong PR never gets it merged into or closed.
 */
export async function findOpenPrs(io: Io, options: FlowOptions): Promise<OpenPr[]> {
  const result = await mustRun(io, "gh", [
    "pr",
    "list",
    "--label",
    options.label,
    "--state",
    "open",
    "--json",
    "number,headRefName,baseRefName,isCrossRepository,headRefOid,body,url",
  ]);
  const prs = (JSON.parse(result.stdout) as OpenPr[]).toSorted((a, b) => b.number - a.number);
  return prs.filter((pr) => {
    const ours =
      UPDATE_BRANCH.test(pr.headRefName) &&
      pr.baseRefName === options.baseBranch &&
      !pr.isCrossRepository;
    if (!ours) {
      io.log(
        `Leaving PR #${String(pr.number)} alone: it has the ${options.label} label but is not the updater's (head ${pr.headRefName} into ${pr.baseRefName}).`,
      );
    }
    return ours;
  });
}

interface Start {
  /** The base commit the PR is compared against: origin/<baseBranch>, or --from. */
  readonly baseSha: string;
  /** True when merging the base into the open PR conflicted and the run started from the base. */
  readonly freshStart: boolean;
}

/** Checks out the starting point: the open PR's branch with the base merged in, or the base. */
async function checkoutStart(
  io: Io,
  options: FlowOptions,
  openPr: OpenPr | undefined,
): Promise<Start> {
  const fetchRefs = [options.baseBranch, ...(openPr === undefined ? [] : [openPr.headRefName])];
  await mustRun(io, "git", ["fetch", "--no-tags", "origin", ...fetchRefs]);
  // Resolve before any checkout: a ref such as HEAD or HEAD~1 moves when HEAD does.
  const baseRef = options.startRef ?? `origin/${options.baseBranch}`;
  const baseSha = (
    await mustRun(io, "git", ["rev-parse", "--verify", `${baseRef}^{commit}`])
  ).stdout.trim();
  if (openPr === undefined) {
    await mustRun(io, "git", ["checkout", "--detach", baseSha]);
    return { baseSha, freshStart: false };
  }
  await mustRun(io, "git", ["checkout", "--detach", `origin/${openPr.headRefName}`]);
  const merge = await io.run("git", [...authorArgs(options), "merge", "--no-edit", baseSha]);
  if (merge.code === 0) return { baseSha, freshStart: false };
  io.log(
    `Merging ${baseRef} into ${openPr.headRefName} conflicted; starting again from ${baseRef}.`,
  );
  await mustRun(io, "git", ["merge", "--abort"]);
  await mustRun(io, "git", ["checkout", "--detach", baseSha]);
  return { baseSha, freshStart: true };
}

/** The repository's version files as they are at the base commit. */
interface BaseSnapshot {
  readonly specs: Map<string, string>;
  readonly locked: Map<string, string>;
  readonly node: string;
  readonly bun: string;
}

/** The bun version a manifest's `packageManager` names, or "" when it names none. */
export function bunVersionOf(manifest: Manifest | undefined): string {
  const value = manifest?.packageManager;
  return typeof value === "string" ? value.replace(/^bun@/, "") : "";
}

async function readAtCommit(io: Io, sha: string, path: string): Promise<string | undefined> {
  const result = await io.run("git", ["show", `${sha}:${path}`]);
  return result.code === 0 ? result.stdout : undefined;
}

export async function readBase(io: Io, sha: string): Promise<BaseSnapshot> {
  const read = await Promise.all(
    (await readManifests(io)).map(async ({ path }) => ({
      path,
      text: await readAtCommit(io, sha, path),
    })),
  );
  const files: ManifestFile[] = read.flatMap(({ path, text }) =>
    text === undefined ? [] : [{ path, json: JSON.parse(text) as Manifest }],
  );
  const root = files.find((file) => file.path === "package.json")?.json;
  return {
    specs: collectSpecs(files),
    locked: parseLockedVersions((await readAtCommit(io, sha, "bun.lock")) ?? ""),
    node: ((await readAtCommit(io, sha, ".nvmrc")) ?? "").trim(),
    bun: bunVersionOf(root),
  };
}

/** "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.join(", ").replace(/, (?=[^,]*$)/, " and ");
}

/** bun and Node changes the PR makes against the base. */
async function runtimeChanges(io: Io, base: BaseSnapshot): Promise<RuntimeChange[]> {
  const root = JSON.parse(await io.readFile("package.json")) as Manifest;
  const bun = bunVersionOf(root);
  const node = (await io.readFile(".nvmrc")).trim();
  const image = (await io.exists(DOCKERFILE)) ? [`the image in \`${DOCKERFILE}\``] : [];
  const files = (...names: string[]) => listed([...names, ...image]);
  const changes: RuntimeChange[] = [];
  if (base.bun !== "" && bun !== base.bun) {
    changes.push({
      name: "bun",
      from: base.bun,
      to: bun,
      files: files("`packageManager`", "`engines.bun`"),
    });
  }
  if (base.node !== "" && node !== base.node) {
    changes.push({
      name: "Node",
      from: base.node,
      to: node,
      files: files("`.nvmrc`", "`engines.node`"),
    });
  }
  return changes;
}

function authorArgs(options: FlowOptions): string[] {
  return ["-c", `user.name=${options.author.name}`, "-c", `user.email=${options.author.email}`];
}

async function updatePackages(
  io: Io,
  holds: readonly Hold[],
  nodeMajor: string,
): Promise<Restoration[]> {
  const before = collectDeclarations(await readManifests(io));
  const lockedBefore = parseLockedVersions(await io.readFile("bun.lock"));
  await mustRun(io, "bun", ["update", "-r", "--latest", "--ignore-scripts"]);
  const updated = await readManifests(io);
  const typesNodeHold: Hold = {
    packages: ["@types/node"],
    range: `^${nodeMajor}.0.0`,
    reason: `Kept on Node's major version (${nodeMajor}).`,
  };
  const restorations = enforceHolds(
    [...holds, typesNodeHold],
    before,
    collectDeclarations(updated),
  );
  if (restorations.length > 0) await restore(io, restorations, lockedBefore);
  return restorations;
}

/** Writes each declaration's spec at its own place. */
async function writeSpecs(io: Io, declarations: readonly Declaration[]): Promise<void> {
  await Promise.all(
    applyDeclarations(await readManifests(io), declarations).map((file) =>
      io.writeFile(file.path, formatManifest(file.json)),
    ),
  );
}

/**
 * Puts the held packages' specs back. bun keeps a locked version that satisfies its spec, so a
 * package that must stay where it was is first pinned to its earlier locked version and
 * installed, then given its spec back: the lockfile keeps that version.
 */
async function restore(
  io: Io,
  restorations: readonly Restoration[],
  lockedBefore: ReadonlyMap<string, string>,
): Promise<void> {
  const specs = restorations.map(({ path, section, name, restoredTo }): Declaration => ({
    path,
    section,
    name,
    spec: restoredTo,
  }));
  const pins = specs.flatMap((declaration, index) => {
    const locked = lockedBefore.get(declaration.name);
    return restorations[index]?.keepLocked === true &&
      locked !== undefined &&
      locked !== declaration.spec
      ? [{ ...declaration, spec: locked }]
      : [];
  });
  if (pins.length > 0) {
    await writeSpecs(io, [...specs, ...pins]);
    await mustRun(io, "bun", ["install", "--ignore-scripts"]);
  }
  await writeSpecs(io, specs);
  await mustRun(io, "bun", ["install", "--ignore-scripts"]);
}

/** `candidate` when it is newer than `current`, else undefined. */
function newerThan(candidate: string | undefined, current: string): string | undefined {
  return candidate !== undefined && compareVersions(candidate, current) > 0 ? candidate : undefined;
}

interface RuntimeMove {
  readonly runtime: Runtime;
  readonly from: string;
  readonly to: string;
}

const RUNTIME_NAMES: Readonly<Record<Runtime, string>> = { node: "Node", bun: "bun" };

/**
 * Moves the Dockerfile's base images with the runtimes, each to its new tag's digest. A runtime
 * whose new image cannot be resolved does not move at all, so the Dockerfile and the version
 * sources still agree; the note says why. Returns the moves that were made.
 */
async function moveDockerfile(
  io: Io,
  moves: readonly RuntimeMove[],
): Promise<{ readonly moved: RuntimeMove[]; readonly notes: string[] }> {
  if (moves.length === 0 || !(await io.exists(DOCKERFILE))) return { moved: [...moves], notes: [] };
  let text = await io.readFile(DOCKERFILE);
  const moved: RuntimeMove[] = [];
  const notes: string[] = [];
  for (const move of moves) {
    const image = RUNTIME_IMAGES[move.runtime];
    const tag = tagFor(text, move.runtime, move.to);
    try {
      const digest = await resolveImageDigest(io, image, tag);
      io.log(`Resolved ${image}:${tag} to ${digest}.`);
      text = moveRuntime(text, move.runtime, { from: move.from, to: move.to, digest });
      moved.push(move);
    } catch (error) {
      notes.push(
        `${RUNTIME_NAMES[move.runtime]} ${move.to} is not applied: the image ${image}:${tag} could not be resolved (${(error as Error).message}).`,
      );
    }
  }
  await io.writeFile(DOCKERFILE, text);
  return { moved, notes };
}

async function updateRuntimes(io: Io, now: Date): Promise<string[]> {
  const root = JSON.parse(await io.readFile("package.json")) as Manifest;
  const currentNode = (await io.readFile(".nvmrc")).trim();
  const currentBun = bunVersionOf(root);
  const notApplied: string[] = [];

  const bun = pickBunRelease((await io.fetchJson(BUN_RELEASES_URL)) as GitHubRelease[], now);
  if (bun === undefined) {
    notApplied.push(
      `bun is not checked: none of the newest ${String(BUN_RELEASES_PAGE)} bun releases on GitHub is a stable release at least 3 days old.`,
    );
  }
  const nodeMajor = Number(currentNode.split(".")[0]);
  const node = pickNodeRelease(
    (await io.fetchJson(NODE_INDEX_URL)) as NodeIndexEntry[],
    nodeMajor,
    now,
  );

  const candidates: RuntimeMove[] = [
    { runtime: "node" as const, from: currentNode, to: newerThan(node.version, currentNode) },
    { runtime: "bun" as const, from: currentBun, to: newerThan(bun, currentBun) },
  ].flatMap((move) => (move.to === undefined ? [] : [{ ...move, to: move.to }]));
  const { moved, notes } = await moveDockerfile(io, candidates);
  notApplied.push(...notes);
  const newNode = moved.find((move) => move.runtime === "node")?.to;
  const newBun = moved.find((move) => move.runtime === "bun")?.to;
  if (newNode !== undefined) {
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
      `Node ${String(node.newerLtsMajor)} is a newer LTS line. Moving to it is a manual change: it also moves \`@types/node\` to that major, and the Dockerfile's Node image.`,
    );
  }
  return notApplied;
}

export async function checkExpo(io: Io): Promise<string[]> {
  if (!(await io.exists("apps/mobile/package.json"))) {
    io.log("apps/mobile does not exist, so there is no Expo version check.");
    return [];
  }
  const result = await io.run("bunx", ["expo", "install", "--check"], { cwd: "apps/mobile" });
  if (result.code === 0) return [];
  const text = `${result.stdout}\n${result.stderr}`.trim();
  const output = text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  // Expo names each package that drifted as `name@version - expected version: range`; a
  // failure without such a line means the check did not run (no network, a crash).
  const finding = / - expected version: /.test(text)
    ? "reports drift"
    : `could not run (exit ${String(result.code)}), so Expo drift is not checked`;
  return [`\`expo install --check\` in apps/mobile ${finding}:\n\n  \`\`\`\n${output}\n  \`\`\``];
}

interface RegistryDocument {
  readonly "dist-tags"?: { readonly latest?: string };
  readonly time?: Readonly<Record<string, string>>;
}

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The release the age gate holds back. When it holds back the latest column, that is the
 * registry's `latest`. When it holds back only the spec's column, it is the newest release
 * above that column and below the latest one, which the gate already allows: the registry's
 * `latest` is outside the spec there, and not held back at all.
 */
function heldBackRelease(row: OutdatedRow, doc: RegistryDocument): string | undefined {
  if (row.latestHeld) return doc["dist-tags"]?.latest;
  return Object.keys(doc.time ?? {})
    .filter(
      (version) =>
        PLAIN_VERSION.test(version) &&
        compareVersions(version, row.update) > 0 &&
        compareVersions(version, row.latest) < 0,
    )
    .toSorted(compareVersions)
    .at(-1);
}

export async function packagesHeldByAge(io: Io): Promise<AgeHeldPackage[]> {
  const result = await io.run("bun", ["outdated", "-r"]);
  const rows = parseOutdated(result.stdout).filter((row) => row.heldByAge);
  const unique = [...new Map(rows.map((row) => [row.name, row])).values()];
  return Promise.all(
    unique.map(async (row) => {
      try {
        const doc = (await io.fetchJson(
          `https://registry.npmjs.org/${row.name.replace("/", "%2f")}`,
        )) as RegistryDocument;
        const newest = heldBackRelease(row, doc);
        const publishedAt = newest === undefined ? undefined : doc.time?.[newest];
        const held: { -readonly [Key in keyof AgeHeldPackage]: AgeHeldPackage[Key] } = {
          name: row.name,
          current: row.current,
        };
        if (newest !== undefined) held.newest = newest;
        if (publishedAt !== undefined) held.publishedAt = publishedAt;
        return held;
      } catch {
        return { name: row.name, current: row.current };
      }
    }),
  );
}

export function versionChanges(
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

/** Shown in place of a version for a package one side of the lockfile does not have. */
const NONE = "(none)";

/** The packages in `names` that bun.lock gained or lost. */
function addedOrRemoved(
  names: Iterable<string>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): IndirectChange[] {
  return [...new Set(names)].flatMap((name) => {
    const from = before.get(name);
    const to = after.get(name);
    if ((from === undefined) === (to === undefined)) return [];
    return [{ name, from: from ?? NONE, to: to ?? NONE }];
  });
}

/** Packages no manifest names that moved in, came into or left bun.lock. */
function indirectChanges(
  direct: ReadonlySet<string>,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): IndirectChange[] {
  const names = [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => !direct.has(name),
  );
  const moved = names.flatMap((name) => {
    const from = before.get(name);
    const to = after.get(name);
    return from === undefined || to === undefined || from === to ? [] : [{ name, from, to }];
  });
  return [...moved, ...addedOrRemoved(names, before, after)];
}

/** The marker that ends a PR body, naming the commit the body describes. */
const HEAD_MARKER = /<!-- dependency-update head: (\S+) -->/;

function withHead(body: string, sha: string): string {
  return `${body}\n<!-- dependency-update head: ${sha} -->\n`;
}

type Write = (command: string, args: readonly string[], input?: string) => Promise<CommandResult>;

function writer(io: Io, options: FlowOptions): Write {
  return async (command, args, input) => {
    if (options.dryRun) {
      io.log(`Would run: ${[command, ...args].join(" ")}`);
      return { code: 0, stdout: DRY_RUN_URL, stderr: "" };
    }
    return mustRun(io, command, args, input === undefined ? undefined : { input });
  };
}

/** Comments on and closes each older update PR, pointing at the one that replaces it. */
async function closeSuperseded(write: Write, older: readonly OpenPr[], url: string): Promise<void> {
  for (const pr of older) {
    await write("gh", ["pr", "comment", String(pr.number), "--body", `Superseded by ${url}.`]);
    await write("gh", ["pr", "close", String(pr.number), "--delete-branch"]);
  }
}

/** What the update found, gathered before deciding whether there is anything to publish. */
interface Findings {
  readonly date: string;
  readonly base: BaseSnapshot;
  readonly freshStart: boolean;
  readonly restorations: readonly Restoration[];
  readonly notApplied: readonly string[];
  readonly heldByAge: readonly AgeHeldPackage[];
}

/** The PR body for the files as they are now, compared with the base. */
async function describe(io: Io, options: FlowOptions, found: Findings): Promise<string> {
  const lockedAfter = parseLockedVersions(await io.readFile("bun.lock"));
  const declaredAfter = collectSpecs(await readManifests(io));
  const direct = new Set([...found.base.specs.keys(), ...declaredAfter.keys()]);
  return buildPrBody({
    date: found.date,
    baseBranch: options.baseBranch,
    freshStart: found.freshStart,
    changes: versionChanges(direct, found.base.locked, lockedAfter),
    addedOrRemoved: addedOrRemoved(direct, found.base.locked, lockedAfter),
    indirect: indirectChanges(direct, found.base.locked, lockedAfter),
    runtimes: await runtimeChanges(io, found.base),
    notApplied: [
      ...found.restorations.map(
        (restoration) =>
          `${restoration.name} stays at ${restoration.restoredTo} (newest allowed: ${specBaseVersion(restoration.attempted) ?? restoration.attempted}): ${restoration.reason}`,
      ),
      ...found.notApplied,
    ],
    heldByAge: found.heldByAge,
  });
}

/**
 * With no file to change, the open PR is left alone (docs/dependencies.md, step 6) unless its
 * body names a commit other than the PR's head: an earlier run pushed and then failed to edit
 * the body, so the body is rewritten for the head. A body without the marker is never touched.
 */
async function repairBody(
  io: Io,
  write: Write,
  openPr: OpenPr | undefined,
  body: () => Promise<string>,
): Promise<FlowOutcome> {
  const described = openPr === undefined ? undefined : HEAD_MARKER.exec(openPr.body)?.[1];
  if (openPr === undefined || described === undefined || described === openPr.headRefOid) {
    io.log("Nothing to update: no file changed on top of the starting point.");
    return { kind: "unchanged" };
  }
  io.log(`The body of ${openPr.url} describes ${described}, not its head; rewriting it.`);
  const repaired = withHead(await body(), openPr.headRefOid);
  await write("gh", ["pr", "edit", String(openPr.number), "--body-file", "-"], repaired);
  return { kind: "updated", branch: openPr.headRefName, url: openPr.url, body: repaired };
}

/** Pushes the commit and opens or updates the PR; returns the PR and the PRs it replaces. */
async function publish(
  write: Write,
  options: FlowOptions,
  open: {
    readonly pr: OpenPr | undefined;
    readonly date: string;
    readonly branch: string;
    readonly body: string;
  },
): Promise<{ readonly outcome: Published; readonly replaced: readonly OpenPr[] }> {
  const { pr, date, branch, body } = open;
  if (pr?.headRefName === branch) {
    // A lease rather than a plain push: after a conflict forced a fresh start, the new
    // commit does not descend from the branch, and a plain push would be rejected.
    await write("git", [
      "push",
      `--force-with-lease=refs/heads/${branch}:origin/${branch}`,
      "origin",
      `HEAD:refs/heads/${branch}`,
    ]);
    await write("gh", ["pr", "edit", String(pr.number), "--body-file", "-"], body);
    return { outcome: { kind: "updated", branch, url: pr.url, body }, replaced: [] };
  }
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
  return { outcome: { kind: "opened", branch, url, body }, replaced: pr === undefined ? [] : [pr] };
}

export async function runDependencyUpdate(io: Io, options: FlowOptions): Promise<FlowOutcome> {
  const date = options.now.toISOString().slice(0, 10);
  const branch = `deps/update-${date}`;
  const write = writer(io, options);

  // Only the newest update PR is built on; any older one an interrupted run left open is closed.
  const [openPr, ...older] = await findOpenPrs(io, options);
  io.log(
    openPr === undefined
      ? "No open dependency-update PR."
      : `Open dependency-update PR: ${openPr.url}`,
  );
  const { baseSha, freshStart } = await checkoutStart(io, options, openPr);
  // The PR body compares against the base, so updates carried over from the open PR's
  // branch are listed too. Holds are enforced against the starting point instead.
  const base = await readBase(io, baseSha);

  const holds = parseHolds(JSON.parse(await io.readFile("dependency-holds.json")) as unknown);
  const nvmrc = (await io.readFile(".nvmrc")).trim();
  const nodeMajor = nvmrc.slice(0, nvmrc.indexOf("."));

  const restorations = await updatePackages(io, holds, nodeMajor);
  const runtimeNotes = await updateRuntimes(io, options.now);
  const expoNotes = await checkExpo(io);
  const found: Findings = {
    date,
    base,
    freshStart,
    restorations,
    notApplied: [...runtimeNotes, ...expoNotes],
    heldByAge: await packagesHeldByAge(io),
  };

  const status = await mustRun(io, "git", ["status", "--porcelain"]);
  if (status.stdout.trim() === "") {
    if (openPr !== undefined) await closeSuperseded(write, older, openPr.url);
    return repairBody(io, write, openPr, () => describe(io, options, found));
  }

  const body = await describe(io, options, found);
  await mustRun(io, "git", ["add", "--all"]);
  await mustRun(io, "git", [
    ...authorArgs(options),
    "commit",
    "--quiet",
    "-m",
    `Update dependencies (${date})`,
  ]);
  const head = (await mustRun(io, "git", ["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();

  const { outcome, replaced } = await publish(write, options, {
    pr: openPr,
    date,
    branch,
    body: withHead(body, head),
  });
  await closeSuperseded(write, [...replaced, ...older], outcome.url);

  if (options.dryRun) {
    io.log("PR body:");
    io.log(outcome.body);
  }
  return outcome;
}
