/**
 * What the Markdown docs point at, so a test can check it exists: the `bun run <name>` commands
 * they mention, their relative links with anchors, and the repository paths they name in code
 * spans. `doc-references.test.ts` runs these over the docs.
 */

/** A thing a doc points at, and the line it is on. */
export interface Reference {
  readonly target: string;
  readonly line: number;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function captures(markdown: string, pattern: RegExp): Reference[] {
  return [...markdown.matchAll(pattern)].map((match) => {
    const [, target = ""] = match;
    return { target, line: lineOf(markdown, match.index) };
  });
}

/** The script names after `bun run` (flags such as `--cwd` are not names). */
export function bunRunScripts(markdown: string): Reference[] {
  return captures(markdown, /\bbun run ([a-z][\w:.-]*)/g);
}

/** The targets of Markdown links that are not web, mail or same-page-only links. */
export function relativeLinks(markdown: string): Reference[] {
  return captures(markdown, /\]\(([^)\s]+)\)/g).filter(
    (reference) => !/^(?:[a-z]+:|#)/.test(reference.target),
  );
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every heading's anchor in a Markdown text, outside fenced code. */
export function anchors(markdown: string): Set<string> {
  const found = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6} (.+)$/.exec(line);
    if (heading?.[1] !== undefined) found.add(headingAnchor(heading[1]));
  }
  return found;
}

/** Repository paths in code spans: `a/b/c.ts`, `dir/`, `file.json`; not placeholders or globs. */
export function codePaths(markdown: string): Reference[] {
  return captures(markdown, /`([^`\s<>*{}]+)`/g).filter(
    ({ target }) =>
      !target.startsWith("@") &&
      !target.includes("://") &&
      /^\.?[\w-][\w.-]*(?:\/[\w.-]+)*\/?$/.test(target) &&
      (target.includes("/") || /\.(?:md|json|jsonc|toml|ts|yml|cjs|mjs|lock)$/.test(target)),
  );
}
