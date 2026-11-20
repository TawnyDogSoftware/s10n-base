/**
 * What the rename replaces and where: the base's names (`S10N Base`, `@s10n-base`, `s10n-base`,
 * `s10n_base`, `s10nbase`, `com.example.s10nbase` and the cookie prefix), the rules that replace
 * them, the files left alone, and the checks that run afterwards. `rename.ts` runs them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Git } from "../quality/commit-attribution";

/** The names a project chooses. */
export interface ProjectNames {
  /** Shown to people: the page title, the app's name, email footers. `Acme Notes`. */
  readonly name: string;
  /** The workspace packages' npm scope. `@acme`. */
  readonly scope: string;
  /** The machine name: the root package, Expo slug, image, compose project, database. `acme-notes`. */
  readonly slug: string;
  /** Reverse-domain base of the iOS bundle identifier and Android package. `com.acme.notes`. */
  readonly bundleId: string;
  /** The mobile app's URL scheme; preview and development builds add `-preview` and `-dev`. */
  readonly scheme: string;
  /** The auth cookies' prefix: `<prefix>.session_token`. Defaults to the slug. */
  readonly cookiePrefix: string;
}

/** The base's own names, which the rename replaces. */
export const BASE_NAMES: ProjectNames = {
  name: "S10N Base",
  scope: "@s10n-base",
  slug: "s10n-base",
  bundleId: "com.example.s10nbase",
  scheme: "s10nbase",
  cookiePrefix: "s10n-base",
};

/**
 * Paths the rename leaves alone, because they are the base's history or name the base on
 * purpose: the plans, the changelog, the decision records, the guide to starting from the
 * template, and this script with its fixtures.
 */
const KEPT: readonly string[] = [
  "plans/",
  "CHANGELOG.md",
  "docs/adr/",
  "docs/new-project.md",
  "scripts/rename/",
];

/** Whether the rename leaves `file` (a path relative to the root, with `/`) alone. */
export function isKept(file: string): boolean {
  return KEPT.some((kept) => (kept.endsWith("/") ? file.startsWith(kept) : file === kept));
}

/** One kind of replacement. */
export interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * The replacements, in the order they apply. Order matters: the scope and the cookie prefix are
 * spelled like the slug, and the bundle identifier contains the scheme, so the narrower rule runs
 * first.
 */
export function renameRules(names: ProjectNames): Rule[] {
  return [
    // `@s10n-base/client`, and `@s10n-base\/` in the server bundler's pattern.
    { name: "package scope", pattern: /@s10n-base(?=\\?\/)/g, replacement: names.scope },
    { name: "bundle identifier", pattern: /com\.example\.s10nbase/g, replacement: names.bundleId },
    { name: "display name", pattern: /S10N Base/g, replacement: names.name },
    // `s10n-base.session_token`, `s10n-base\.` in a test's pattern, and the constant itself.
    {
      name: "cookie prefix",
      pattern: /s10n-base(?=\\?\.)|(?<=AUTH_COOKIE_PREFIX = ")s10n-base(?=")/g,
      replacement: names.cookiePrefix,
    },
    { name: "URL scheme", pattern: /s10nbase/g, replacement: names.scheme },
    // The compose file's, CI's and the tests' database, role and password.
    { name: "database name", pattern: /s10n_base/g, replacement: names.slug.replaceAll("-", "_") },
    { name: "slug", pattern: /s10n-base/g, replacement: names.slug },
  ];
}

/** `text` with every rule applied, and how many times each rule matched. */
export function applyRules(
  text: string,
  rules: readonly Rule[],
): { readonly text: string; readonly counts: ReadonlyMap<string, number> } {
  const counts = new Map<string, number>();
  let result = text;
  for (const rule of rules) {
    result = result.replace(rule.pattern, () => {
      counts.set(rule.name, (counts.get(rule.name) ?? 0) + 1);
      return rule.replacement;
    });
  }
  return { text: result, counts };
}

/** Any spelling of the base's name: what must be gone after a rename. */
const LEFTOVER = /s10n|app-scaffold/i;

/** A tracked text file. */
export interface TextFile {
  readonly file: string;
  readonly text: string;
}

/** `file:line: text` for every line outside `KEPT` that still names the base. */
export function leftovers(files: readonly TextFile[]): string[] {
  return files
    .filter((entry) => !isKept(entry.file))
    .flatMap((entry) =>
      entry.text
        .split("\n")
        .flatMap((line, index) =>
          LEFTOVER.test(line) ? [`${entry.file}:${String(index + 1)}: ${line.trim()}`] : [],
        ),
    );
}

/** Every text file git tracks under `root` (a file with a NUL byte is binary and skipped). */
export function trackedTextFiles(git: Git, root: string): TextFile[] {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter((file) => file !== "")
    .flatMap((file) => {
      const bytes = readFileSync(path.join(root, file));
      return bytes.includes(0) ? [] : [{ file, text: bytes.toString("utf8") }];
    });
}

/** The third-party packages bun.lock resolves, as `name@version` (workspace entries left out). */
export function lockedVersions(lockfile: string): string[] {
  const found = new Set<string>();
  for (const [, resolved = ""] of lockfile.matchAll(/^ {4}"[^"]+": \["([^"]+)"/gm)) {
    if (!resolved.includes("@workspace:")) found.add(resolved);
  }
  return [...found].toSorted((a, b) => a.localeCompare(b));
}

/** What is in one list and not the other, as lines for a report. */
export function versionChanges(before: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(after);
  const had = new Set(before);
  return [
    ...before.filter((entry) => !kept.has(entry)).map((entry) => `- ${entry}`),
    ...after.filter((entry) => !had.has(entry)).map((entry) => `+ ${entry}`),
  ];
}
