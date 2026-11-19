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

/**
 * Reads the `dependencies` a top-level package's own manifest declares, as bun.lock records
 * them. Undefined when the package has no top-level entry.
 */
export function parseLockedDependencies(
  lockText: string,
  name: string,
): Map<string, string> | undefined {
  for (const line of lockText.split("\n")) {
    const match = /^\s+"([^"]+)": \["((?:@[^/"]+\/)?[^@"]+)@[^"]+", "[^"]*", (\{.*\})/.exec(line);
    if (match === null) continue;
    const [, key, pkg, metaText = "{}"] = match;
    if (key !== name || pkg !== name) continue;
    const meta = JSON.parse(metaText) as { dependencies?: Record<string, string> };
    return new Map(Object.entries(meta.dependencies ?? {}));
  }
  return undefined;
}
