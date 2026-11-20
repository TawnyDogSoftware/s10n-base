import { describe, expect, it } from "vitest";

import { authSchemaDifferences, type ColumnShape, type TableShapes } from "./schema-check";

const text: ColumnShape = { type: "text", nullable: false, unique: false, indexed: false };
const expected: TableShapes = {
  ba_user: {
    id: { type: "uuid", nullable: false, unique: true, indexed: true },
    email: { ...text, unique: true, indexed: true },
    name: text,
  },
  ba_session: {
    id: { type: "uuid", nullable: false, unique: true, indexed: true },
    user_id: {
      type: "uuid",
      nullable: false,
      unique: false,
      indexed: true,
      references: { target: "ba_user.id", onDelete: "CASCADE" },
    },
  },
};

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The fixture has no ${what}.`);
  return value;
}

function change(table: string, column: string, shape: Partial<ColumnShape> | undefined) {
  const copy = structuredClone(expected) as Record<string, Record<string, ColumnShape>>;
  const columns = defined(copy[table], table);
  if (shape === undefined) {
    copy[table] = Object.fromEntries(Object.entries(columns).filter(([name]) => name !== column));
  } else {
    // A column the fixture lacks starts from a plain text column.
    columns[column] = { ...(columns[column] ?? text), ...shape };
  }
  return copy;
}

describe("authSchemaDifferences", () => {
  it("is empty when the database matches", () => {
    expect(authSchemaDifferences(expected, structuredClone(expected))).toEqual([]);
  });

  it("allows an extra index", () => {
    expect(authSchemaDifferences(expected, change("ba_user", "name", { indexed: true }))).toEqual(
      [],
    );
  });

  it.each([
    ["a column Better Auth added (missing in the database)", "ba_user", "email", undefined],
    ["another type", "ba_user", "email", { type: "character varying" }],
    ["another nullability", "ba_user", "email", { nullable: true }],
    ["a lost unique index", "ba_user", "email", { unique: false }],
    ["a missing index", "ba_session", "user_id", { indexed: false }],
    ["a missing foreign key", "ba_session", "user_id", { references: undefined }],
    [
      "another delete rule",
      "ba_session",
      "user_id",
      { references: { target: "ba_user.id", onDelete: "SET NULL" } },
    ],
  ] as const)("reports %s", (_name, table, column, shape) => {
    const problems = authSchemaDifferences(expected, change(table, column, shape));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${table}\\.${column}: `));
  });

  it("reports a column only the database has, and a table only one side has", () => {
    const actual = change("ba_user", "nickname", { ...text });
    const withTable = { ...actual, ba_extra: { id: defined(expected.ba_user?.id, "ba_user.id") } };
    const withoutSession = { ba_user: defined(expected.ba_user, "ba_user") };

    expect(authSchemaDifferences(expected, withTable)).toEqual([
      "ba_extra: in the database, but Better Auth does not use it",
      "ba_user.nickname: in the database, but Better Auth does not use it",
    ]);
    expect(authSchemaDifferences(expected, withoutSession)).toEqual([
      "ba_session: Better Auth expects this table, but the database has none",
    ]);
  });
});
