export interface OutdatedRow {
  readonly name: string;
  readonly current: string;
  readonly latest: string;
  /** True when a newer release exists that the 3-day rule does not allow yet. */
  readonly heldByAge: boolean;
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
    const [packageCell, current, update, latest] = cells;
    if (
      packageCell === undefined ||
      current === undefined ||
      update === undefined ||
      latest === undefined
    ) {
      continue;
    }
    rows.push({
      name: packageCell.replace(/ \((?:dev|peer|optional)\)$/, ""),
      current,
      latest: latest.replace(/\*$/, "").trimEnd(),
      heldByAge: update.endsWith("*") || latest.endsWith("*"),
    });
  }
  return rows;
}
