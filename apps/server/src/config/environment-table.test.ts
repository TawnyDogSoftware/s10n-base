import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  environmentTables,
  renderEnvironmentTable,
  type EnvironmentRow,
} from "./environment-table";

const deployment = readFileSync(
  path.resolve(import.meta.dirname, "../../../../docs/deployment.md"),
  "utf8",
);

/** The rows of the table between `<!-- environment:<name> -->` and its closing marker. */
function documentedRows(text: string, name: string): EnvironmentRow[] {
  const start = text.indexOf(`<!-- environment:${name} -->`);
  const end = text.indexOf(`<!-- /environment:${name} -->`);
  if (start === -1 || end < start) throw new Error(`docs/deployment.md has no ${name} table`);
  return text
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) => {
      const [variable = "", required = "", defaultValue = "", rule = "", production = ""] = line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim());
      return { variable, required, defaultValue, rule, production };
    });
}

describe("the environment tables in docs/deployment.md", () => {
  it.each(Object.keys(environmentTables))(
    "list the %s's variables as the code reads them",
    (name) => {
      const expected = environmentTables[name] ?? [];

      expect(
        documentedRows(deployment, name),
        `Replace the ${name} table in docs/deployment.md with:\n\n${renderEnvironmentTable(expected)}\n`,
      ).toEqual(expected);
    },
  );

  it("fails on a missing table", () => {
    expect(() => documentedRows("no tables here", "server")).toThrow(
      "docs/deployment.md has no server table",
    );
  });
});

describe("renderEnvironmentTable", () => {
  it("renders a header and one row per variable", () => {
    expect(
      renderEnvironmentTable([
        { variable: "`A`", required: "yes", defaultValue: "", rule: "must be a", production: "" },
      ]),
    ).toBe(
      [
        "| Variable | Required | Default | Rule | In production |",
        "| --- | --- | --- | --- | --- |",
        "| `A` | yes |  | must be a |  |",
      ].join("\n"),
    );
  });
});
