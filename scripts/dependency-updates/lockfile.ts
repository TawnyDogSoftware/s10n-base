/**
 * Reads the version each top-level package resolves to in bun.lock. Nested entries
 * (keys with a `/` after the package name, such as `postcss/source-map-js`) are skipped.
 */
export function parseLockedVersions(lockText: string): Map<string, string> {
  const versions = new Map<string, string>();
  const entry = /^[ \t]+"([^"]+)": \["((?:@[^/"]+\/)?[^@"]+)@([^"]+)"/gm;
  for (const match of lockText.matchAll(entry)) {
    const [, key, name, version] = match;
    if (key !== undefined && key === name && version !== undefined) {
      versions.set(key, version);
    }
  }
  return versions;
}

interface LockedPackage {
  readonly version: string;
  readonly dependencies: Map<string, string>;
}

/** A top-level package's version and the `dependencies` its own manifest declares. */
function readLockedPackage(lockText: string, name: string): LockedPackage | undefined {
  for (const line of lockText.split("\n")) {
    const match = /^\s+"([^"]+)": \["((?:@[^/"]+\/)?[^@"]+)@([^"]+)", "[^"]*", (\{.*\})/.exec(line);
    if (match === null) continue;
    const [, key, pkg, version = "", metaText = "{}"] = match;
    if (key !== name || pkg !== name) continue;
    const meta = JSON.parse(metaText) as { dependencies?: Record<string, string> };
    return { version, dependencies: new Map(Object.entries(meta.dependencies ?? {})) };
  }
  return undefined;
}

/**
 * Reads the `dependencies` a top-level package's own manifest declares, as bun.lock records
 * them. Undefined when the package has no top-level entry.
 */
export function parseLockedDependencies(
  lockText: string,
  name: string,
): Map<string, string> | undefined {
  return readLockedPackage(lockText, name)?.dependencies;
}

/** The version of the entry with exactly this key: a package name, or `<parent>/<name>`. */
function lockedAt(lockText: string, key: string): string | undefined {
  const start = `"${key}": ["`;
  const line = lockText.split("\n").find((candidate) => candidate.trimStart().startsWith(start));
  return line?.trimStart().slice(start.length).split('"')[0]?.split("@").at(-1);
}

/**
 * The version of `name` that the installed `parent` uses, with the parent's own version.
 * A dependency the parent pins exactly is that version. For a range it is what bun resolved for
 * the parent: its own copy, which bun 1.4.4 records under `<parent>/<name>` when the top-level
 * copy is outside the range, and otherwise the top-level copy. Undefined when the parent is not
 * installed, does not depend on `name`, or nothing was resolved.
 */
export function resolveLockedDependency(
  lockText: string,
  parent: string,
  name: string,
): { readonly parentVersion: string; readonly version: string } | undefined {
  const locked = readLockedPackage(lockText, parent);
  const declared = locked?.dependencies.get(name);
  if (locked === undefined || declared === undefined) return undefined;
  const version = /^\d+\.\d+\.\d+$/.test(declared)
    ? declared
    : (lockedAt(lockText, `${parent}/${name}`) ?? lockedAt(lockText, name));
  return version === undefined ? undefined : { parentVersion: locked.version, version };
}
