/**
 * Reads the version each top-level package resolves to in bun.lock. Nested entries
 * (keys with a `/` after the package name, such as `postcss/source-map-js`) are skipped.
 */
export function parseLockedVersions(lockText: string): Map<string, string> {
  const versions = new Map<string, string>();
  const entry = /^\s+"([^"]+)": \["((?:@[^/"]+\/)?[^@"]+)@([^"]+)"/gm;
  for (const match of lockText.matchAll(entry)) {
    const [, key, name, version] = match;
    if (key !== undefined && key === name && version !== undefined) {
      versions.set(key, version);
    }
  }
  return versions;
}
