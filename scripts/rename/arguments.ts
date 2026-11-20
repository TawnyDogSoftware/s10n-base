/**
 * The rename's command line: `--name`, `--scope`, `--slug`, `--bundle-id`, `--scheme`, optional
 * `--cookie-prefix` and `--dry-run`. Every value is checked before anything is written, and every
 * problem is reported at once.
 */
import type { ProjectNames } from "./rules";

const FLAGS = {
  "--name": "name",
  "--scope": "scope",
  "--slug": "slug",
  "--bundle-id": "bundleId",
  "--scheme": "scheme",
  "--cookie-prefix": "cookiePrefix",
} as const satisfies Record<string, keyof ProjectNames>;

type Flag = keyof typeof FLAGS;

function isFlag(value: string): value is Flag {
  return Object.hasOwn(FLAGS, value);
}

/** Lowercase words of letters and digits joined by single hyphens, starting with a letter. */
function isKebab(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value) && !value.includes("--") && !value.endsWith("-");
}

const JAVA_KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double " +
    "else enum extends final finally float for goto if implements import instanceof int " +
    "interface long native new package private protected public return short static strictfp " +
    "super switch synchronized this throw throws transient try void volatile while true false null"
  ).split(" "),
);

function isBundleId(value: string): boolean {
  const parts = value.split(".");
  return (
    value.length <= 100 &&
    parts.length >= 2 &&
    parts.every((part) => /^[a-z][a-z0-9]*$/.test(part) && !JAVA_KEYWORDS.has(part))
  );
}

/** Schemes a platform or Expo already owns. */
const RESERVED_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "exp",
  "file",
  "ftp",
  "http",
  "https",
  "javascript",
  "mailto",
  "sms",
  "tel",
]);

/** Each value's rule, as a test and the words that explain it. */
const RULES: Record<keyof ProjectNames, { test: (value: string) => boolean; rule: string }> = {
  name: {
    test: (value) => /^[A-Za-z0-9][A-Za-z0-9 .-]{0,38}[A-Za-z0-9]$/.test(value),
    rule: "2 to 40 letters, digits, spaces, dots or hyphens, starting and ending with a letter or digit",
  },
  scope: {
    test: (value) => value.startsWith("@") && isKebab(value.slice(1)) && value.length <= 41,
    rule: "@ followed by lowercase letters, digits and single hyphens, starting with a letter",
  },
  slug: {
    test: (value) => isKebab(value) && value.length <= 40,
    rule: "lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters",
  },
  bundleId: {
    test: isBundleId,
    rule: "a reverse domain of at least two lowercase parts, each starting with a letter, such as com.acme.notes (no hyphens or Java keywords: Android packages cannot have them)",
  },
  scheme: {
    test: (value) => isKebab(value) && value.length <= 40 && !RESERVED_SCHEMES.has(value),
    rule: "lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters, and not one a platform owns (http, exp, ...)",
  },
  cookiePrefix: {
    test: (value) => isKebab(value) && value.length <= 40,
    rule: "lowercase letters, digits and single hyphens, starting with a letter, at most 40 characters",
  },
};

const FLAG_OF = Object.fromEntries(
  Object.entries(FLAGS).map(([flag, key]) => [key, flag]),
) as Record<keyof ProjectNames, Flag>;

/** Everything wrong with `names`; empty when every value can be used. */
export function namesProblems(names: ProjectNames): string[] {
  return (Object.keys(RULES) as Array<keyof ProjectNames>).flatMap((key) => {
    const value = names[key];
    const flag = FLAG_OF[key];
    if (/s10n|app-scaffold/i.test(value)) {
      return [`${flag} must not contain the base's own name; got "${value}"`];
    }
    return RULES[key].test(value) ? [] : [`${flag} must be ${RULES[key].rule}; got "${value}"`];
  });
}

/** What the command line asked for. */
export interface RenameArguments {
  readonly names: ProjectNames;
  readonly dryRun: boolean;
}

function readFlags(argv: readonly string[]): {
  values: Partial<Record<keyof ProjectNames, string>>;
  dryRun: boolean;
  problems: string[];
} {
  const values: Partial<Record<keyof ProjectNames, string>> = {};
  const problems: string[] = [];
  const rest = [...argv];
  let dryRun = false;
  while (rest.length > 0) {
    const arg = rest.shift() as string;
    const value = rest[0];
    if (arg === "--dry-run") dryRun = true;
    else if (!isFlag(arg)) problems.push(`unknown argument: ${arg}`);
    else if (value === undefined || value.startsWith("--")) problems.push(`${arg} needs a value`);
    else values[FLAGS[arg]] = rest.shift() as string;
  }
  return { values, dryRun, problems };
}

/**
 * Reads and checks the command line.
 *
 * @returns the arguments, or every problem with them.
 */
export function parseRenameArguments(
  argv: readonly string[],
):
  | { readonly ok: true; readonly args: RenameArguments }
  | { readonly ok: false; readonly problems: string[] } {
  const { values, dryRun, problems } = readFlags(argv);
  const missing = (["name", "scope", "slug", "bundleId", "scheme"] as const)
    .filter((key) => values[key] === undefined)
    .map((key) => `${FLAG_OF[key]} is required`);
  if (problems.length > 0 || missing.length > 0)
    return { ok: false, problems: [...problems, ...missing] };
  const given = values as Omit<ProjectNames, "cookiePrefix"> & { cookiePrefix?: string };
  const names: ProjectNames = { ...given, cookiePrefix: given.cookiePrefix ?? given.slug };
  const invalid = namesProblems(names);
  return invalid.length > 0
    ? { ok: false, problems: invalid }
    : { ok: true, args: { names, dryRun } };
}
