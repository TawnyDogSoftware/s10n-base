import { resolveLockedDependency } from "./lockfile";
import type { Declaration } from "./manifests";
import { satisfies, specBaseVersion } from "./semver";

/**
 * One entry of dependency-holds.json. Without `range`, `group` or `follows` the packages are not
 * updated by the daily job at all; with `range` they move only inside it; members of a
 * `group` move only when they all land on the same version; with `follows` they never move on
 * their own, and are set to exactly the version the installed package they follow depends on.
 */
export interface Hold {
  readonly packages: readonly string[];
  readonly reason: string;
  readonly range?: string;
  readonly group?: string;
  /** The name of the package whose dependency on these packages decides their version. */
  readonly follows?: string;
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
  if (entry.follows !== undefined) hold.follows = parseFollows(entry, label);
  return hold;
}

/** The package a follower follows. The name need not be installed, or held, to be valid. */
function parseFollows(entry: Record<string, unknown>, label: string): string {
  const { follows } = entry;
  if (typeof follows !== "string" || follows.trim() === "") {
    throw new Error(`${label}: follows must be a package name`);
  }
  if (entry.range !== undefined || entry.group !== undefined) {
    throw new Error(`${label}: follows cannot be combined with range or group`);
  }
  return follows;
}

export function parseHolds(json: unknown): Hold[] {
  if (!isRecord(json) || !Array.isArray(json.holds)) {
    throw new Error("dependency-holds.json needs a holds array");
  }
  const holds = (json.holds as unknown[]).map(parseHold);
  for (const [index, { follows }] of holds.entries()) {
    // One step only: a follower's version comes from a package that moves by the other rules.
    if (follows !== undefined && findHold(holds, follows)?.follows !== undefined) {
      throw new Error(
        `dependency-holds.json entry ${String(index + 1)}: follows ${follows}, which is itself a follower`,
      );
    }
  }
  return holds;
}

/**
 * A hold without a range never lets its package move; one with a range, only inside it. A
 * follower has no range, so the update never moves it: `followerMoves` does, afterwards.
 */
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

/** A follower that is not on the version the package it follows depends on. */
export interface FollowerMove {
  readonly follower: string;
  readonly followed: string;
  /** The installed version of the followed package. */
  readonly followedVersion: string;
  /** The exact version the follower must be on. */
  readonly wanted: string;
}

/**
 * The followers to move, for the manifests and lockfile as they are: each declared package held
 * with `follows` whose declarations are not all exactly the version the installed followed
 * package uses. A follower whose followed package is not installed, or no longer depends on it,
 * has nothing to follow and is left alone.
 */
export function followerMoves(
  holds: readonly Hold[],
  declarations: readonly Declaration[],
  lockText: string,
): FollowerMove[] {
  return [...new Set(declarations.map(({ name }) => name))].flatMap((follower) => {
    const followed = findHold(holds, follower)?.follows;
    if (followed === undefined) return [];
    const resolved = resolveLockedDependency(lockText, followed, follower);
    const specs = declarations.filter(({ name }) => name === follower).map(({ spec }) => spec);
    if (resolved === undefined || specs.every((spec) => spec === resolved.version)) return [];
    return [
      { follower, followed, followedVersion: resolved.parentVersion, wanted: resolved.version },
    ];
  });
}

/** Whether `name` is the followed package or is held in the same group as it. */
function movesWith(holds: readonly Hold[], name: string, followed: string): boolean {
  const group = findHold(holds, followed)?.group;
  return name === followed || (group !== undefined && findHold(holds, name)?.group === group);
}

/** The manifests and lockfile before the update, and after it with the followers moved. */
export interface FollowerState {
  readonly before: readonly Declaration[];
  readonly after: readonly Declaration[];
  readonly lockedBefore: ReadonlyMap<string, string>;
  readonly lockedAfter: ReadonlyMap<string, string>;
}

/**
 * The restorations for followers whose version could not be installed: each follower, the
 * package it follows and every member of that package's group go back to where they were before
 * the update, so the follower and the followed package never end up disagreeing. A package
 * whose spec stayed but whose locked version moved (a range) goes back too.
 */
export function restoreFollowed(
  holds: readonly Hold[],
  moves: readonly FollowerMove[],
  state: FollowerState,
  detail: string,
): Restoration[] {
  const earlier = new Map(state.before.map((declaration) => [placeOf(declaration), declaration]));
  return state.after.flatMap((declaration) => {
    const { name, spec } = declaration;
    const move = moves.find(
      ({ follower, followed }) => name === follower || movesWith(holds, name, followed),
    );
    const original = earlier.get(placeOf(declaration))?.spec;
    if (move === undefined || original === undefined) return [];
    const locked = state.lockedAfter.get(name);
    const attempted = spec === original ? locked : spec;
    if (attempted === undefined || attempted === state.lockedBefore.get(name)) return [];
    return [
      {
        path: declaration.path,
        section: declaration.section,
        name,
        attempted,
        restoredTo: original,
        reason: `${move.follower} ${move.wanted}, which ${move.followed} ${move.followedVersion} depends on, could not be installed (${detail}), so ${move.followed} and the packages held with it stay where they were.`,
        keepLocked: true,
      },
    ];
  });
}
