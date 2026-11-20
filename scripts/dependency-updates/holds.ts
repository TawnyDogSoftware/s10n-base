import { satisfies, specBaseVersion } from "./semver";

/**
 * One entry of dependency-holds.json. Without `range` or `group` the packages are not
 * updated by the daily job at all; with `range` they move only inside it; members of a
 * `group` move only when they all land on the same version.
 */
export interface Hold {
  readonly packages: readonly string[];
  readonly reason: string;
  readonly range?: string;
  readonly group?: string;
}

export interface Restoration {
  readonly name: string;
  readonly attempted: string;
  readonly restoredTo: string;
  readonly reason: string;
  /**
   * Whether the package must also stay at the version locked before the update. True unless the
   * hold lets it move inside a range: a range spec put back may still allow what the update
   * locked, and bun keeps a locked version that satisfies its spec.
   */
  readonly keepLocked: boolean;
}

/** Matches a package name against a pattern where `*` stands for any characters. */
export function matchesPattern(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

export function findHold(holds: readonly Hold[], name: string): Hold | undefined {
  return holds.find((hold) => hold.packages.some((pattern) => matchesPattern(name, pattern)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPackageList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((name) => typeof name === "string" && name !== "")
  );
}

function optionalString(value: unknown, problem: string): string | undefined {
  if (value !== undefined && typeof value !== "string") throw new Error(problem);
  return value;
}

function parseHold(entry: unknown, index: number): Hold {
  const label = `dependency-holds.json entry ${String(index + 1)}`;
  if (!isRecord(entry)) throw new Error(`${label} must be an object`);
  const { packages, reason } = entry;
  if (!isPackageList(packages)) throw new Error(`${label} needs at least one package`);
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error(`${label} needs a reason`);
  }
  const range = optionalString(entry.range, `${label}: range must be a string`);
  const group = optionalString(entry.group, `${label}: group must be a string`);
  const hold: { -readonly [Key in keyof Hold]: Hold[Key] } = { packages, reason };
  if (range !== undefined) {
    // Throws on a range the update cannot read, so a typo fails here and not in the update.
    satisfies("0.0.0", range);
    hold.range = range;
  }
  if (group !== undefined) hold.group = group;
  return hold;
}

export function parseHolds(json: unknown): Hold[] {
  const entries = isRecord(json) && Array.isArray(json.holds) ? (json.holds as unknown[]) : [];
  return entries.map(parseHold);
}

/** A hold without a range never lets its package move; one with a range, only inside it. */
function allowedByHold(hold: Hold, spec: string): boolean {
  return hold.range !== undefined && satisfies(specBaseVersion(spec) ?? "", hold.range);
}

/** A group moves only when every member lands on one version, inside the range if there is one. */
function groupAllowed(hold: Hold, specs: readonly string[]): boolean {
  if (new Set(specs.map(specBaseVersion)).size > 1) return false;
  const { range } = hold;
  return (
    range === undefined || specs.every((spec) => satisfies(specBaseVersion(spec) ?? "", range))
  );
}

/**
 * Compares specs before and after `bun update --latest` and returns the held packages
 * that must go back to their earlier spec.
 */
export function enforceHolds(
  holds: readonly Hold[],
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Restoration[] {
  const restorations: Restoration[] = [];
  const restore = (name: string, hold: Hold) => {
    const attempted = after.get(name);
    const original = before.get(name);
    if (attempted !== undefined && original !== undefined && attempted !== original) {
      restorations.push({
        name,
        attempted,
        restoredTo: original,
        reason: hold.reason,
        keepLocked: hold.range === undefined || hold.group !== undefined,
      });
    }
  };

  const groups = new Map<string, { hold: Hold; specs: Map<string, string> }>();
  for (const [name, spec] of after) {
    const hold = findHold(holds, name);
    if (hold === undefined) continue;
    if (hold.group === undefined) {
      if (!allowedByHold(hold, spec)) restore(name, hold);
      continue;
    }
    const members = groups.get(hold.group) ?? { hold, specs: new Map<string, string>() };
    members.specs.set(name, spec);
    groups.set(hold.group, members);
  }

  for (const { hold, specs } of groups.values()) {
    if (!groupAllowed(hold, [...specs.values()])) {
      for (const name of specs.keys()) restore(name, hold);
    }
  }

  return restorations;
}
