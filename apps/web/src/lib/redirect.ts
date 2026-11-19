/**
 * Returns `target` when it is a path on this site, so a `redirect` search parameter cannot send
 * someone elsewhere after they sign in. It must start with a single `/` and contain no backslash
 * or control character (browsers read `/\host` and `/\t/host` as another host). Anything else
 * gives `undefined`. What is left is a path-absolute URL, which always resolves on this origin.
 */
export function safeRedirect(target: unknown): string | undefined {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return undefined;
  }
  // Backslashes and C0 controls: URL parsers strip or normalise them into "//".
  for (const character of target) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code < 0x20 || code === 0x7f) return undefined;
  }
  return target;
}
