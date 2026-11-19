/**
 * Checks what Metro put in the mobile app's bundle, from the source maps `expo export
 * --source-maps` writes: one copy of each package that must be single (two Reacts break hooks;
 * two copies of Expo's native module core break native modules), the workspace packages bundled
 * from their TypeScript source, and no test code. bun's default linker gives each package its own
 * directory under `node_modules/.bun`, so a second copy shows up as a second directory.
 *
 * Usage, from the repository root: `bun scripts/mobile-bundle/check.ts apps/mobile/dist` (after
 * `bun run mobile:export`).
 */
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** Packages that must have exactly one copy in a bundle. */
export const SINGLETONS = [
  "react",
  "react-native",
  "scheduler",
  "expo",
  "expo-modules-core",
  "expo-router",
  "@tanstack/query-core",
  "@tanstack/react-query",
  "i18next",
  "react-i18next",
  "effect",
  "uniwind",
] as const;

/** The workspace packages the app imports, which must be bundled from their source. */
export const WORKSPACE_PACKAGES = ["client", "contracts", "i18n", "shared"] as const;

/** A file's package directory and name: the innermost `node_modules` entry, scoped or not. */
const PACKAGE = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//;

/** Maps a package directory, as the source map names it, to where it really is. */
export type ResolveDirectory = (directory: string) => string;

/**
 * For each package name, the directories its bundled files came from. Metro names a few files
 * by a symlinked path (`apps/mobile/node_modules/expo/...`); `resolve` follows such links, so one
 * package is not counted twice.
 */
export function packageInstances(
  sources: readonly string[],
  resolve: ResolveDirectory = (directory) => directory,
): Map<string, Set<string>> {
  const instances = new Map<string, Set<string>>();
  for (const source of sources) {
    const match = PACKAGE.exec(source);
    if (match === null) continue;
    const [, directory = "", name = ""] = match;
    const set = instances.get(name) ?? new Set<string>();
    set.add(resolve(directory));
    instances.set(name, set);
  }
  return instances;
}

function isTestCode(source: string): boolean {
  if (source.includes("/node_modules/")) return false;
  return (
    /\.test\.[cm]?[jt]sx?$/.test(source) ||
    source.startsWith("/apps/mobile/src/test/") ||
    source.startsWith("/packages/client/src/testing/")
  );
}

/** Everything wrong with a bundle's sources, as sentences; empty when it passes. */
export function checkBundleSources(
  sources: readonly string[],
  resolve?: ResolveDirectory,
): string[] {
  const problems: string[] = [];
  const instances = packageInstances(sources, resolve);
  for (const name of SINGLETONS) {
    const found = [...(instances.get(name) ?? [])].sort();
    if (found.length > 1) problems.push(`${found.length} copies of ${name}: ${found.join(", ")}`);
  }
  for (const source of sources) {
    if (isTestCode(source)) problems.push(`test code in the bundle: ${source}`);
  }
  for (const name of WORKSPACE_PACKAGES) {
    if (!sources.some((source) => source.startsWith(`/packages/${name}/src/`))) {
      problems.push(`@s10n-base/${name} is not bundled from packages/${name}/src`);
    }
  }
  return problems;
}

function sourceMaps(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".map"))
    .map((file) => path.join(directory, file));
}

/** Follows symlinks from the repository root; a directory that does not exist stays as named. */
function realDirectory(root: string): ResolveDirectory {
  return (directory) => {
    try {
      return path.relative(root, realpathSync(path.join(root, directory)));
    } catch {
      return directory;
    }
  };
}

function main(directory: string): number {
  const resolve = realDirectory(process.cwd());
  const maps = sourceMaps(directory);
  if (maps.length === 0) {
    console.error(`No source maps under ${directory}: export with --source-maps.`);
    return 1;
  }
  let failed = false;
  for (const map of maps) {
    const { sources } = JSON.parse(readFileSync(map, "utf8")) as { sources: string[] };
    const problems = checkBundleSources(sources, resolve);
    const react = [...(packageInstances(sources, resolve).get("react") ?? [])];
    console.log(
      `${path.relative(directory, map)}: ${sources.length} files; react from ${react.join(", ")}`,
    );
    for (const problem of problems) console.error(`  ${problem}`);
    failed ||= problems.length > 0;
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv[2] ?? "apps/mobile/dist"));
}
