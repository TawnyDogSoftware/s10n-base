import type { Declaration } from "./manifests";
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

/** A declaration of a held package that goes back to its earlier spec, at the same place. */
export interface Restoration {
  readonly path: string;
  readonly section: Declaration["section"];
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
  if (!isRecord(json) || !Array.isArray(json.holds)) {
    throw new Error("dependency-holds.json needs a holds array");
  }
  return (json.holds as unknown[]).map(parseHold);
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

function placeOf(declaration: Declaration): string {
  return `${declaration.path}\0${declaration.section}\0${declaration.name}`;
}

/**
 * Compares declarations before and after `bun update --latest` and returns the declarations of
 * held packages that must go back to their earlier spec. Each place a package is declared is
 * checked on its own, and a group's members are compared across every place they appear.
 */
export function enforceHolds(
  holds: readonly Hold[],
  before: readonly Declaration[],
  after: readonly Declaration[],
): Restoration[] {
  const earlier = new Map(before.map((declaration) => [placeOf(declaration), declaration.spec]));
  const restorations: Restoration[] = [];
  const restore = (declaration: Declaration, hold: Hold) => {
    const original = earlier.get(placeOf(declaration));
    if (original !== undefined && declaration.spec !== original) {
      restorations.push({
        path: declaration.path,
        section: declaration.section,
        name: declaration.name,
        attempted: declaration.spec,
        restoredTo: original,
        reason: hold.reason,
        keepLocked: hold.range === undefined || hold.group !== undefined,
      });
    }
  };

  const groups = new Map<string, { hold: Hold; members: Declaration[] }>();
  for (const declaration of after) {
    const hold = findHold(holds, declaration.name);
    if (hold === undefined) continue;
    if (hold.group === undefined) {
      if (!allowedByHold(hold, declaration.spec)) restore(declaration, hold);
      continue;
    }
    const group = groups.get(hold.group) ?? { hold, members: [] };
    group.members.push(declaration);
    groups.set(hold.group, group);
  }

  for (const { hold, members } of groups.values()) {
    if (
      !groupAllowed(
        hold,
        members.map(({ spec }) => spec),
      )
    ) {
      for (const declaration of members) restore(declaration, hold);
    }
  }

  return restorations;
}
