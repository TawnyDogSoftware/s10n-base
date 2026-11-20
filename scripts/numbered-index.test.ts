import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fileNumber,
  headingTitle,
  indexProblems,
  indexRows,
  type NumberedFile,
} from "./numbered-index";

const root = path.resolve(import.meta.dirname, "..");

/** The numbered files of a directory, with their first lines. */
function numberedFiles(dir: string): NumberedFile[] {
  return readdirSync(path.join(root, dir))
    .filter((file) => fileNumber(file) !== undefined)
    .map((file) => ({
      file,
      heading: readFileSync(path.join(root, dir, file), "utf8").split("\n")[0] ?? "",
    }));
}

describe.each(["plans", "docs/adr"])("the index of %s", (dir) => {
  it("lists every numbered file once, with its title and a status, and nothing else", () => {
    const index = readFileSync(path.join(root, dir, "README.md"), "utf8");

    expect(indexProblems(index, numberedFiles(dir))).toEqual([]);
    expect(indexRows(index).length).toBeGreaterThan(0);
  });
});

const INDEX = [
  "# Plans",
  "",
  "| Number | Plan | Status |",
  "| --- | --- | --- |",
  "| 001 | [First](001-first.md) | Implemented |",
  "| 002 | [Second](002-second.md) | Not started |",
].join("\n");

const FILES: NumberedFile[] = [
  { file: "001-first.md", heading: "# 001: First" },
  { file: "002-second.md", heading: "# 002: Second" },
  { file: "README.md", heading: "# Plans" },
];

describe("indexProblems", () => {
  it("accepts an index that matches the files", () => {
    expect(indexProblems(INDEX, FILES)).toEqual([]);
  });

  it("fails when a numbered file is missing from the index", () => {
    expect(
      indexProblems(INDEX, [...FILES, { file: "003-third.md", heading: "# 003: Third" }]),
    ).toEqual(["003-third.md is missing from the index"]);
  });

  it("fails when a number is used twice, in the files or in the index", () => {
    const files = [...FILES, { file: "002-other.md", heading: "# 002: Other" }];
    const index = `${INDEX}\n| 002 | [Other](002-other.md) | Not started |`;

    expect(indexProblems(index, files)).toEqual([
      "002 is the number of more than one file",
      "002 is listed twice",
    ]);
  });

  it("fails when the index lists a file that does not exist", () => {
    expect(indexProblems(`${INDEX}\n| 004 | [Gone](004-gone.md) | Withdrawn |`, FILES)).toEqual([
      "004 lists 004-gone.md, which does not exist",
    ]);
  });

  it("fails on a row whose number, title or status does not match", () => {
    const index = INDEX.replace("| 001 | [First]", "| 003 | [Frist]").replace(
      "| Not started |",
      "|  |",
    );

    expect(indexProblems(index, FILES)).toEqual([
      "003 lists 001-first.md, whose number differs",
      '003\'s title is "Frist" but 001-first.md says "First"',
      "002 has no status",
    ]);
  });
});

describe("the pieces", () => {
  it("reads a heading's title with or without its number", () => {
    expect(headingTitle("# 004: Auth")).toBe("Auth");
    expect(headingTitle("# Architecture decision records")).toBe("Architecture decision records");
  });

  it("knows a numbered file by its name", () => {
    expect(fileNumber("012-tags.md")).toBe("012");
    expect(fileNumber("README.md")).toBeUndefined();
    expect(fileNumber("12-tags.md")).toBeUndefined();
  });

  it("reads only table rows that link a document", () => {
    const lines = [
      "| Number | Plan | Status |",
      "| --- | --- | --- |",
      "| 001 | First | x |",
      "| 01 | [First](001-first.md) | x |",
      "| 001 | [First](001-first.md) |",
      "001 | [First](001-first.md) | x |",
      "text",
      "  | 002 | [Second](002-second.md) | Not started |  ",
    ];

    expect(indexRows(lines.join("\n"))).toEqual([
      { number: "002", title: "Second", file: "002-second.md", status: "Not started" },
    ]);
  });
});
