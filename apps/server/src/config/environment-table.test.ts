import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type ConfigProblem,
  databaseVariables,
  migrationVariables,
  productionRules,
  serverVariables,
} from "./index";

/*
 * The environment tables in docs/deployment.md, built here from the variables the config module
 * reads and compared with the docs, so the docs cannot drift from the code.
 */

interface DescribedVariable {
  readonly name: string;
  readonly rule: string;
  readonly defaultText?: string;
  readonly optional?: true;
}

/** One row of a table: the cells as they appear in the docs, backticks included. */
interface EnvironmentRow {
  readonly variable: string;
  readonly required: string;
  readonly defaultValue: string;
  readonly rule: string;
  readonly production: string;
}

function code(text: string): string {
  return `\`${text}\``;
}

/** "must use https when NODE_ENV is production" becomes "must use https". */
function productionText(name: string, rules: ReadonlyArray<ConfigProblem>): string {
  return rules
    .filter((rule) => rule.variable === name)
    .map((rule) => rule.problem.replace(/ when NODE_ENV is production(?::.*)?$/, ""))
    .join("; ");
}

function rowsFor(
  variables: ReadonlyArray<DescribedVariable>,
  rules: ReadonlyArray<ConfigProblem>,
): EnvironmentRow[] {
  return variables.map((entry) => ({
    variable: code(entry.name),
    required: entry.defaultText === undefined && entry.optional !== true ? "yes" : "no",
    defaultValue: entry.defaultText === undefined ? "" : code(entry.defaultText),
    rule: `must ${entry.rule}`,
    production: productionText(entry.name, rules),
  }));
}

/** The rows of each table, keyed by the command that reads the variables. */
const environmentTables: Readonly<Record<string, ReadonlyArray<EnvironmentRow>>> = {
  server: rowsFor(serverVariables, productionRules),
  migrate: rowsFor(migrationVariables, []),
  "set-role": rowsFor(databaseVariables, []),
};

/** A table as Markdown, to paste into the docs when the test reports a difference. */
function renderEnvironmentTable(rows: ReadonlyArray<EnvironmentRow>): string {
  const lines = [
    "| Variable | Required | Default | Rule | In production |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${[row.variable, row.required, row.defaultValue, row.rule, row.production].join(" | ")} |`,
    ),
  ];
  return lines.join("\n");
}

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
