/**
 * Compares the auth tables in a database with the schema Better Auth expects for our options:
 * tables, columns, column types, nullability, unique columns, indexed columns and foreign keys.
 * The migration is written by hand, so this is what catches a Better Auth upgrade that adds or
 * changes a column, and a migration that drifts from the options.
 */
import type { BetterAuthOptions } from "better-auth";
import { getSchema } from "better-auth/db";
import { type Kysely, sql } from "kysely";

export interface ColumnShape {
  /** Postgres `information_schema` data type, such as `text` or `timestamp with time zone`. */
  readonly type: string;
  readonly nullable: boolean;
  /** Has a unique index on this column alone. */
  readonly unique: boolean;
  /** Is the first column of some index. */
  readonly indexed: boolean;
  /** `table.column` it references, and what a delete there does. */
  readonly references?: { readonly target: string; readonly onDelete: string } | undefined;
}

export type TableShapes = Readonly<Record<string, Readonly<Record<string, ColumnShape>>>>;

/**
 * Columns whose shape we choose beyond what Better Auth declares, with the reason. Better Auth
 * declares `impersonated_by` as a plain string; it holds a user id, so it is a `uuid` with a
 * foreign key, and the admin's impersonation sessions end with the admin.
 */
export const OWN_CHOICES: Readonly<Record<string, Partial<ColumnShape>>> = {
  "ba_session.impersonated_by": {
    type: "uuid",
    indexed: true,
    references: { target: "ba_user.id", onDelete: "CASCADE" },
  },
};

const TYPES: Readonly<Record<string, string>> = {
  string: "text",
  boolean: "boolean",
  date: "timestamp with time zone",
  json: "jsonb",
};

type FieldDefinition = ReturnType<typeof getSchema>[string]["fields"][string];

/** The Postgres type a Better Auth field should have. A reference to a user id is a uuid. */
function columnType(field: FieldDefinition): string {
  if (field.references?.field === "id") return "uuid";
  if (field.type === "number") return field.bigint === true ? "bigint" : "integer";
  return TYPES[String(field.type)] ?? `unsupported:${String(field.type)}`;
}

/** The tables and columns Better Auth expects for `options`, as Postgres should hold them. */
export function expectedAuthTables(options: BetterAuthOptions): TableShapes {
  const tables: Record<string, Record<string, ColumnShape>> = {};
  for (const [table, definition] of Object.entries(getSchema(options))) {
    const columns: Record<string, ColumnShape> = {
      id: { type: "uuid", nullable: false, unique: true, indexed: true },
    };
    for (const [column, field] of Object.entries(definition.fields)) {
      const reference = field.references;
      columns[column] = {
        type: columnType(field),
        nullable: field.required === false,
        unique: field.unique === true,
        indexed: field.unique === true || field.index === true,
        // Every reference to a user cascades, including the passkey plugin's, which declares
        // no delete rule: a deleted user's passkeys must go with them.
        ...(reference === undefined
          ? {}
          : {
              references: { target: `${reference.model}.${reference.field}`, onDelete: "CASCADE" },
            }),
        ...OWN_CHOICES[`${table}.${column}`],
      };
    }
    tables[table] = columns;
  }
  return tables;
}

function describe(shape: ColumnShape): string {
  return [
    shape.type,
    shape.nullable ? "null" : "not null",
    shape.unique ? "unique" : "not unique",
    shape.references === undefined
      ? "no reference"
      : `references ${shape.references.target} on delete ${shape.references.onDelete}`,
  ].join(", ");
}

function columnProblem(wanted: ColumnShape, found: ColumnShape): string | undefined {
  if (describe(wanted) !== describe(found)) {
    return `expected ${describe(wanted)}; found ${describe(found)}`;
  }
  // An extra index costs only writes; a missing one turns a lookup into a scan.
  if (wanted.indexed && !found.indexed) return "expected an index; found none";
  return undefined;
}

/**
 * Every difference between `expected` and `actual`, one line each; empty when they match. Tables
 * and columns must match both ways, and so must types, nullability, unique columns and foreign
 * keys. An index Better Auth expects must exist; an extra one is allowed.
 */
export function authSchemaDifferences(expected: TableShapes, actual: TableShapes): string[] {
  const problems: string[] = [];
  const tableNames = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const table of [...tableNames].toSorted((left, right) => left.localeCompare(right))) {
    const want = expected[table];
    const have = actual[table];
    if (want === undefined) {
      problems.push(`${table}: in the database, but Better Auth does not use it`);
      continue;
    }
    if (have === undefined) {
      problems.push(`${table}: Better Auth expects this table, but the database has none`);
      continue;
    }
    problems.push(...columnDifferences(table, want, have));
  }
  return problems;
}

function columnDifferences(
  table: string,
  want: Readonly<Record<string, ColumnShape>>,
  have: Readonly<Record<string, ColumnShape>>,
): string[] {
  const problems: string[] = [];
  const columnNames = new Set([...Object.keys(want), ...Object.keys(have)]);
  for (const column of [...columnNames].toSorted((left, right) => left.localeCompare(right))) {
    const wanted = want[column];
    const found = have[column];
    if (wanted === undefined) {
      problems.push(`${table}.${column}: in the database, but Better Auth does not use it`);
    } else if (found === undefined) {
      problems.push(`${table}.${column}: Better Auth expects this column, but it is missing`);
    } else {
      const problem = columnProblem(wanted, found);
      if (problem !== undefined) problems.push(`${table}.${column}: ${problem}`);
    }
  }
  return problems;
}

const DELETE_RULES: Readonly<Record<string, string>> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

/** Reads the `ba_*` tables of `schema` in the shape {@link expectedAuthTables} returns. */
export async function readAuthTables(db: Kysely<unknown>, schema: string): Promise<TableShapes> {
  const columns = await sql<{ table: string; column: string; type: string; nullable: string }>`
    select table_name as "table", column_name as "column", data_type as "type",
      is_nullable as "nullable"
    from information_schema.columns
    where table_schema = ${schema} and table_name like 'ba\\_%'
  `.execute(db);
  const indexes = await sql<{ table: string; column: string; unique: boolean; width: number }>`
    select t.relname as "table", a.attname as "column", i.indisunique as "unique",
      i.indnkeyatts as "width"
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where n.nspname = ${schema} and t.relname like 'ba\\_%' and i.indpred is null
  `.execute(db);
  const foreignKeys = await sql<{ table: string; column: string; target: string; rule: string }>`
    select t.relname as "table", a.attname as "column",
      ft.relname || '.' || fa.attname as "target", c.confdeltype as "rule"
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
    join pg_class ft on ft.oid = c.confrelid
    join pg_attribute fa on fa.attrelid = ft.oid and fa.attnum = c.confkey[1]
    where c.contype = 'f' and n.nspname = ${schema} and t.relname like 'ba\\_%'
      and cardinality(c.conkey) = 1
  `.execute(db);

  const tables: Record<string, Record<string, ColumnShape>> = {};
  for (const row of columns.rows) {
    const leading = indexes.rows.filter(
      (index) => index.table === row.table && index.column === row.column,
    );
    const reference = foreignKeys.rows.find(
      (key) => key.table === row.table && key.column === row.column,
    );
    const table = (tables[row.table] ??= {});
    table[row.column] = {
      type: row.type,
      nullable: row.nullable === "YES",
      unique: leading.some((index) => index.unique && index.width === 1),
      indexed: leading.length > 0,
      ...(reference === undefined
        ? {}
        : {
            references: {
              target: reference.target,
              onDelete: DELETE_RULES[reference.rule] ?? reference.rule,
            },
          }),
    };
  }
  return tables;
}
