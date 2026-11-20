/**
 * Copies the packages a workspace needs at run time out of a production install, for the
 * container image: `bun scripts/container/runtime-dependencies.main.ts <root> <workspace> <out>`.
 *
 * bun's default (isolated) linker keeps every package once in `node_modules/.bun/<entry>/
 * node_modules/<name>` and links each package's dependencies next to it, in the same
 * `node_modules`. A workspace's `node_modules` holds links into that store. Copying the whole
 * install would bring every workspace's packages (Expo and React Native among them), so this
 * walks from the workspace's own dependencies through each package's dependencies and required
 * peers, and copies only those store entries, in the same layout, with the same links. The
 * output runs from any directory: `<out>/node_modules` and `<out>/<workspace>/node_modules`.
 *
 * Optional peers are not followed: bun links one whenever the workspace happens to install it
 * (`better-auth` gets React and Vitest that way), and a package is meant to work without them.
 * Their links are kept when the package is copied anyway, since a package may still import one
 * (`better-call` imports `zod`, an optional peer). TypeScript sources and declarations, source
 * maps and packages' own tests are left out: Node never loads them from `node_modules`.
 */
import { cp, lstat, mkdir, readFile, realpath, symlink } from "node:fs/promises";
import path from "node:path";

/** One package the workspace needs at run time. */
export interface RuntimePackage {
  readonly name: string;
  readonly version: string;
  /** Its directory in bun's store, under `node_modules/.bun`. */
  readonly entry: string;
}

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/** A link to follow: from a package's store entry (or the workspace) to a dependency. */
interface Edge {
  /** The directory the link sits in, relative to the root. */
  readonly from: string;
  readonly name: string;
  readonly entry: string;
}

export interface RuntimeClosure {
  readonly packages: ReadonlyArray<RuntimePackage>;
  readonly links: ReadonlyArray<Edge>;
}

const STORE = path.join("node_modules", ".bun");

/** A package's manifest as installed; every published package has a version. */
interface InstalledManifest extends Manifest {
  readonly version: string;
}

async function readManifest(dir: string): Promise<InstalledManifest> {
  return JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as InstalledManifest;
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

/** The packages a workspace declares, other than workspace packages (which are bundled). */
export function runtimeStarts(manifest: Manifest): string[] {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, spec]) => !spec.startsWith("workspace:"))
    .map(([name]) => name)
    .toSorted();
}

interface Need {
  readonly name: string;
  readonly optional: boolean;
}

/** What a package needs: dependencies and required peers always, optional dependencies if installed. */
function needs(manifest: Manifest): Need[] {
  const required = Object.keys(manifest.dependencies ?? {}).map((name) => ({
    name,
    optional: false,
  }));
  const optional = Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({
    name,
    optional: true,
  }));
  const peers = Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => !isOptionalPeer(manifest, name))
    .map((name) => ({ name, optional: false }));
  return [...required, ...optional, ...peers];
}

function isOptionalPeer(manifest: Manifest, name: string): boolean {
  return manifest.peerDependenciesMeta?.[name]?.optional === true;
}

function optionalPeers(manifest: Manifest): string[] {
  return Object.keys(manifest.peerDependencies ?? {}).filter((name) =>
    isOptionalPeer(manifest, name),
  );
}

/** The store entry a link at `linkPath` resolves to, or an error naming what is wrong. */
async function storeEntryOf(root: string, linkPath: string, name: string): Promise<string> {
  const target = path.relative(path.join(root, STORE), await realpath(linkPath));
  const [entry = "", ...rest] = target.split(path.sep);
  if (target.startsWith("..") || rest.join("/") !== `node_modules/${name}`) {
    throw new Error(
      `${name} resolves to ${target}, outside bun's store: a workspace package must be bundled, and the install must use bun's default linker.`,
    );
  }
  return entry;
}

/** Walks from the workspace's dependencies through everything they need at run time. */
export async function collectRuntimeClosure(
  root: string,
  workspace: string,
): Promise<RuntimeClosure> {
  const packages = new Map<string, RuntimePackage>();
  const links: Edge[] = [];
  /** Optional peers bun linked, kept below when their package is in the closure anyway. */
  const peerLinks: Edge[] = [];

  async function visit(from: string, name: string, optional: boolean): Promise<void> {
    const linkPath = path.join(root, from, name);
    if (!(await exists(linkPath))) {
      if (optional) return;
      throw new Error(`${name} is needed by ${from} but is not installed there.`);
    }
    const entry = await storeEntryOf(root, linkPath, name);
    links.push({ from, name, entry });
    if (packages.has(entry)) return;
    const dir = path.join(root, STORE, entry, "node_modules", name);
    const manifest = await readManifest(dir);
    packages.set(entry, { name, version: manifest.version, entry });
    const siblings = path.join(STORE, entry, "node_modules");
    for (const need of needs(manifest)) await visit(siblings, need.name, need.optional);
    for (const peer of optionalPeers(manifest)) {
      const peerPath = path.join(root, siblings, peer);
      if (await exists(peerPath)) {
        peerLinks.push({
          from: siblings,
          name: peer,
          entry: await storeEntryOf(root, peerPath, peer),
        });
      }
    }
  }

  const workspaceModules = path.join(workspace, "node_modules");
  for (const name of runtimeStarts(await readManifest(path.join(root, workspace)))) {
    await visit(workspaceModules, name, false);
  }
  return {
    packages: [...packages.values()].toSorted((a, b) => a.entry.localeCompare(b.entry)),
    // A package may import an optional peer it does not declare as a dependency (better-call
    // imports zod), so the link stays wherever its package is copied for another reason. Linking
    // it adds no package.
    links: [...links, ...peerLinks.filter((link) => packages.has(link.entry))],
  };
}

/**
 * Whether a file is worth copying: Node never loads TypeScript or source maps from a package,
 * and a package's own tests are not part of it at run time (pg-protocol ships some in `dist`).
 */
export function isRuntimeFile(file: string): boolean {
  const name = path.basename(file);
  return (
    !/\.(?:[cm]?ts|map)$/.test(name) &&
    !/\.(?:test|spec)\.[^.]+$/.test(name) &&
    name !== "node_modules"
  );
}

/** Copies the closure into `out`, in the same layout, and returns its packages. */
export async function exportRuntimeDependencies(options: {
  readonly root: string;
  readonly workspace: string;
  readonly out: string;
}): Promise<ReadonlyArray<RuntimePackage>> {
  const { root, workspace, out } = options;
  const closure = await collectRuntimeClosure(root, workspace);
  for (const item of closure.packages) {
    const relative = path.join(STORE, item.entry, "node_modules", item.name);
    const source = path.join(root, relative);
    await cp(source, path.join(out, relative), {
      recursive: true,
      filter: (file) => file === source || isRuntimeFile(path.relative(source, file)),
    });
  }
  for (const link of closure.links) {
    const linkPath = path.join(out, link.from, link.name);
    // A package may name the same dependency twice, as a dependency and as a peer.
    if (await exists(linkPath)) continue;
    const target = path.join(out, STORE, link.entry, "node_modules", link.name);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(path.relative(path.dirname(linkPath), target), linkPath);
  }
  return closure.packages;
}

export interface CommandIo {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/** `runtime-dependencies <root> <workspace> <out>`: prints `name@version` per package. */
export async function runtimeDependenciesCommand(
  argv: ReadonlyArray<string>,
  io: CommandIo,
): Promise<number> {
  const [root, workspace, out] = argv;
  if (root === undefined || workspace === undefined || out === undefined || argv.length > 3) {
    io.error("Usage: runtime-dependencies <root> <workspace> <out>");
    return 2;
  }
  try {
    const packages = await exportRuntimeDependencies({ root, workspace, out });
    for (const item of packages) io.log(`${item.name}@${item.version}`);
    io.log(`${String(packages.length)} runtime packages`);
    return 0;
  } catch (error) {
    io.error((error as Error).message);
    return 1;
  }
}
