/**
 * The small part of semver the dependency tools need: plain x.y.z versions (no
 * prereleases) and the range forms used in dependency-holds.json and the catalog.
 */
type Triple = readonly [number, number, number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): Triple {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new Error(`Not a plain x.y.z version: "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The version written in a spec such as `^8.3.8`, `~6.0.3` or `4.1.4`. */
export function specBaseVersion(spec: string): string | undefined {
  return /^(?:\^|~|>=|=)?\s*(\d+\.\d+\.\d+)$/.exec(spec.trim())?.[1];
}

type Comparator = (version: string) => boolean;

function comparatorsFor(term: string, range: string): Comparator[] {
  const xRange = /^(\d+)\.(\d+)\.[x*]$/.exec(term);
  if (xRange !== null) {
    const major = Number(xRange[1]);
    const minor = Number(xRange[2]);
    const floor = `${String(major)}.${String(minor)}.0`;
    const ceiling = `${String(major)}.${String(minor + 1)}.0`;
    return [(v) => compareVersions(v, floor) >= 0, (v) => compareVersions(v, ceiling) < 0];
  }
  const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(term);
  if (match === null) {
    throw new Error(`Unsupported version range "${range}"`);
  }
  const operator = match[1] ?? "=";
  const target = match[2] ?? "";
  const [major, minor] = parse(target);
  switch (operator) {
    case "^": {
      const ceiling = major > 0 ? `${String(major + 1)}.0.0` : `0.${String(minor + 1)}.0`;
      return [(v) => compareVersions(v, target) >= 0, (v) => compareVersions(v, ceiling) < 0];
    }
    case "~": {
      const ceiling = `${String(major)}.${String(minor + 1)}.0`;
      return [(v) => compareVersions(v, target) >= 0, (v) => compareVersions(v, ceiling) < 0];
    }
    case ">=":
      return [(v) => compareVersions(v, target) >= 0];
    case "<=":
      return [(v) => compareVersions(v, target) <= 0];
    case ">":
      return [(v) => compareVersions(v, target) > 0];
    case "<":
      return [(v) => compareVersions(v, target) < 0];
    default:
      return [(v) => compareVersions(v, target) === 0];
  }
}

/** Throws for a range it cannot read, so a typo in a hold never passes silently. */
export function satisfies(version: string, range: string): boolean {
  const comparators = range
    .trim()
    .split(/\s+/)
    .flatMap((term) => comparatorsFor(term, range));
  if (!VERSION.test(version)) return false;
  return comparators.every((comparator) => comparator(version));
}

export type ChangeKind = "major" | "minor" | "patch";

/** Below 1.0 a minor change counts as major, since 0.x minors may break. */
export function classifyChange(from: string, to: string): ChangeKind {
  const [fromMajor, fromMinor] = parse(from);
  const [toMajor, toMinor] = parse(to);
  if (fromMajor !== toMajor) return "major";
  if (fromMinor !== toMinor) return fromMajor === 0 ? "major" : "minor";
  return "patch";
}
