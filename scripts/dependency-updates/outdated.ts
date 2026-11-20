export interface OutdatedRow {
  readonly name: string;
  readonly current: string;
  /** The newest release the spec allows, as far as the 3-day rule lets bun see. */
  readonly update: string;
  /** The newest release of any spec, as far as the 3-day rule lets bun see. */
  readonly latest: string;
  /** True when a newer release exists that the 3-day rule does not allow yet. */
  readonly heldByAge: boolean;
  /** True when the age gate holds back the latest column itself, not only the spec's. */
  readonly latestHeld: boolean;
}

function unmarked(cell: string): string {
  return cell.replace(/\*$/, "").trimEnd();
}

/** Parses the table `bun outdated` prints; a trailing `*` marks a release held back by age. */
export function parseOutdated(output: string): OutdatedRow[] {
  const rows: OutdatedRow[] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("| ") || /^\|\s*Package\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [packageCell = "", current = "", update = "", latest = ""] = cells;
    rows.push({
      name: packageCell.replace(/ \((?:dev|peer|optional)\)$/, ""),
      current,
      update: unmarked(update),
      latest: unmarked(latest),
      heldByAge: update.endsWith("*") || latest.endsWith("*"),
      latestHeld: latest.endsWith("*"),
    });
  }
  return rows;
}
