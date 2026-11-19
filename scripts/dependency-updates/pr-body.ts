import type { ChangeKind } from "./semver";

export interface VersionChange {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly kind: ChangeKind;
}

export interface IndirectChange {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

export interface RuntimeChange {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly files: string;
}

export interface AgeHeldPackage {
  readonly name: string;
  readonly current: string;
  readonly newest?: string;
  readonly publishedAt?: string;
}

export interface PrBodyInput {
  readonly date: string;
  readonly baseBranch: string;
  readonly freshStart: boolean;
  readonly changes: readonly VersionChange[];
  /** Packages no manifest names directly that moved in bun.lock. */
  readonly indirect: readonly IndirectChange[];
  readonly runtimes: readonly RuntimeChange[];
  readonly notApplied: readonly string[];
  readonly heldByAge: readonly AgeHeldPackage[];
}

const byName = <T extends { readonly name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

function changeTable(changes: readonly IndirectChange[]): string {
  const rows = [...changes]
    .toSorted(byName)
    .map((change) => `| ${change.name} | ${change.from} | ${change.to} |`);
  return ["| Package | From | To |", "| --- | --- | --- |", ...rows].join("\n");
}

export function buildPrBody(input: PrBodyInput): string {
  const sections: string[] = [
    `Dependency update for ${input.date}, opened by the daily dependency-update workflow. ` +
      "Every version is the newest release that is at least 3 days old (`bunfig.toml`), " +
      "except packages held by `dependency-holds.json`.",
  ];

  if (input.freshStart) {
    sections.push(
      `> Merging \`${input.baseBranch}\` into the previous update branch conflicted, so this update starts again from \`${input.baseBranch}\`. Fixes pushed to the previous branch are not carried over.`,
    );
  }

  const kinds: readonly [ChangeKind, string][] = [
    ["major", "Major"],
    ["minor", "Minor"],
    ["patch", "Patch"],
  ];
  if (input.changes.length === 0) {
    sections.push("No direct dependency changed.");
  }
  for (const [kind, title] of kinds) {
    const changes = input.changes.filter((change) => change.kind === kind);
    if (changes.length > 0) sections.push(`## ${title}\n\n${changeTable(changes)}`);
  }

  if (input.indirect.length > 0) {
    const count = input.indirect.length;
    const noun = count === 1 ? "indirect dependency" : "indirect dependencies";
    sections.push(
      `## Indirect dependencies\n\n<details>\n<summary>${count} ${noun} moved in bun.lock</summary>\n\n${changeTable(input.indirect)}\n\n</details>`,
    );
  }

  if (input.runtimes.length > 0) {
    const lines = input.runtimes.map(
      (runtime) => `- ${runtime.name} ${runtime.from} → ${runtime.to} (${runtime.files})`,
    );
    sections.push(`## bun and Node\n\n${lines.join("\n")}`);
  }

  if (input.notApplied.length > 0) {
    sections.push(
      `## Reported, not applied\n\n${input.notApplied.map((line) => `- ${line}`).join("\n")}`,
    );
  }

  if (input.heldByAge.length > 0) {
    const rows = [...input.heldByAge]
      .toSorted(byName)
      .map(
        (pkg) =>
          `| ${pkg.name} | ${pkg.current} | ${pkg.newest ?? "(unknown)"} | ${pkg.publishedAt?.slice(0, 10) ?? "(unknown)"} |`,
      );
    sections.push(
      [
        "## Held back by the 3-day rule",
        "",
        "| Package | Installed | Newest | Published |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
        'To take a bug-fix release before it is 3 days old, follow "Taking a bug-fix release early" in `docs/dependencies.md`.',
      ].join("\n"),
    );
  }

  sections.push(
    "If an update breaks CI, push the fix to this branch. The next run starts from this branch, so the fix carries forward.",
  );

  return `${sections.join("\n\n")}\n`;
}
