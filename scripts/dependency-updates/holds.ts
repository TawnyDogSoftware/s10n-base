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

export function parseHolds(json: unknown): Hold[] {
  const entries = isRecord(json) && Array.isArray(json.holds) ? (json.holds as unknown[]) : [];
  return entries.map((entry, index) => {
    const label = `dependency-holds.json entry ${index + 1}`;
    if (!isRecord(entry)) throw new Error(`${label} must be an object`);
    const { packages, reason, range, group } = entry;
    if (
      !Array.isArray(packages) ||
      packages.length === 0 ||
      !packages.every((name) => typeof name === "string" && name !== "")
    ) {
      throw new Error(`${label} needs at least one package`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`${label} needs a reason`);
    }
    if (range !== undefined && typeof range !== "string")
      throw new Error(`${label}: range must be a string`);
    if (group !== undefined && typeof group !== "string")
      throw new Error(`${label}: group must be a string`);
    if (range !== undefined) satisfies("0.0.0", range);
    return {
      packages: packages as string[],
      reason,
      ...(range === undefined ? {} : { range }),
      ...(group === undefined ? {} : { group }),
    };
  });
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
      restorations.push({ name, attempted, restoredTo: original, reason: hold.reason });
    }
  };

  const groups = new Map<string, { hold: Hold; names: string[] }>();
  for (const name of after.keys()) {
    const hold = findHold(holds, name);
    if (hold === undefined) continue;
    if (hold.group !== undefined) {
      const members = groups.get(hold.group) ?? { hold, names: [] };
      members.names.push(name);
      groups.set(hold.group, members);
    } else if (hold.range === undefined) {
      restore(name, hold);
    } else if (!satisfies(specBaseVersion(after.get(name) ?? "") ?? "", hold.range)) {
      restore(name, hold);
    }
  }

  for (const { hold, names } of groups.values()) {
    const versions = new Set(names.map((name) => specBaseVersion(after.get(name) ?? "")));
    const outOfRange =
      hold.range !== undefined &&
      names.some(
        (name) => !satisfies(specBaseVersion(after.get(name) ?? "") ?? "", hold.range ?? ""),
      );
    if (versions.size > 1 || outOfRange) {
      for (const name of names) restore(name, hold);
    }
  }

  return restorations;
}
