/**
 * The environment tables in docs/deployment.md, built from the variables this module reads, so
 * the docs cannot drift from the code: `environment-table.test.ts` compares them.
 */
import {
  type ConfigProblem,
  databaseVariables,
  migrationVariables,
  productionRules,
  serverVariables,
} from "./index";

interface DescribedVariable {
  readonly name: string;
  readonly rule: string;
  readonly defaultText?: string;
  readonly optional?: true;
}

/** One row of a table: the cells as they appear in the docs, backticks included. */
export interface EnvironmentRow {
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
export const environmentTables: Readonly<Record<string, ReadonlyArray<EnvironmentRow>>> = {
  server: rowsFor(serverVariables, productionRules),
  migrate: rowsFor(migrationVariables, []),
  "set-role": rowsFor(databaseVariables, []),
};

/** A table as Markdown, to paste into the docs when the test reports a difference. */
export function renderEnvironmentTable(rows: ReadonlyArray<EnvironmentRow>): string {
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
