/**
 * Numbered documents and their index: `plans/NNN-slug.md` listed in `plans/README.md`, and
 * `docs/adr/NNN-slug.md` listed in `docs/adr/README.md`. A number is never reused, so a document
 * is never deleted: one that is dropped keeps its file and its row, with a status that says so.
 */

/** One row of an index table: `| NNN | [Title](NNN-slug.md) | Status |`. */
export interface IndexRow {
  readonly number: string;
  readonly title: string;
  readonly file: string;
  readonly status: string;
}

const NUMBER = /^\d{3}$/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/** A table line's three cells, or undefined when it is not a three-column row. */
function tableCells(line: string): readonly [string, string, string] | undefined {
  const cells = line.trim().split("|");
  if (cells.length !== 5 || cells[0] !== "" || cells[4] !== "") return undefined;
  const [number = "", link = "", status = ""] = cells.slice(1, 4).map((cell) => cell.trim());
  return [number, link, status];
}

function indexRow(line: string): IndexRow[] {
  const cells = tableCells(line);
  if (cells === undefined) return [];
  const [number, link, status] = cells;
  const match = LINK.exec(link);
  if (!NUMBER.test(number) || match === null) return [];
  const [, title = "", file = ""] = match;
  return [{ number, title, file, status }];
}

/** The rows of the index's table, in order. Lines that are not rows are ignored. */
export function indexRows(markdown: string): IndexRow[] {
  return markdown.split("\n").flatMap(indexRow);
}

/** A numbered document's file name, and the title from its first heading (`# NNN: Title`). */
export interface NumberedFile {
  readonly file: string;
  readonly heading: string;
}

const FILE = /^(\d{3})-[a-z0-9-]+\.md$/;

/** The number of a numbered document's file name, or undefined for any other file. */
export function fileNumber(file: string): string | undefined {
  return FILE.exec(file)?.[1];
}

/** The `Title` of a document whose first line is `# NNN: Title`, or the whole heading. */
export function headingTitle(firstLine: string): string {
  return firstLine.replace(/^#\s+/, "").replace(/^\d{3}:\s*/, "");
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function rowProblems(row: IndexRow, byFile: ReadonlyMap<string, NumberedFile>): string[] {
  const found = byFile.get(row.file);
  if (found === undefined) return [`${row.number} lists ${row.file}, which does not exist`];
  const problems: string[] = [];
  if (fileNumber(row.file) !== row.number) {
    problems.push(`${row.number} lists ${row.file}, whose number differs`);
  }
  const title = headingTitle(found.heading);
  if (title !== row.title) {
    problems.push(`${row.number}'s title is "${row.title}" but ${row.file} says "${title}"`);
  }
  if (row.status === "") problems.push(`${row.number} has no status`);
  return problems;
}

/** Everything wrong with `index` (the README's text) against the numbered `files`; empty when right. */
export function indexProblems(index: string, files: readonly NumberedFile[]): string[] {
  const rows = indexRows(index);
  const numbered = files.flatMap((entry) => {
    const number = fileNumber(entry.file);
    return number === undefined ? [] : [{ ...entry, number }];
  });
  const byFile = new Map(numbered.map((entry) => [entry.file, entry]));
  const listed = new Set(rows.map((row) => row.file));
  return [
    ...duplicates(numbered.map((entry) => entry.number)).map(
      (number) => `${number} is the number of more than one file`,
    ),
    ...duplicates(rows.map((row) => row.number)).map((number) => `${number} is listed twice`),
    ...rows.flatMap((row) => rowProblems(row, byFile)),
    ...numbered
      .filter((entry) => !listed.has(entry.file))
      .map((entry) => `${entry.file} is missing from the index`),
  ];
}
