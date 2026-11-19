import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vitest";

import { scriptedDb } from "../test/scripted-db";
import { testAuthOptions } from "../test/auth-options";
import { expectedAuthTables, readAuthTables } from "./schema-check";

describe("expectedAuthTables", () => {
  const tables = expectedAuthTables(testAuthOptions());

  it("has every table of the options, with uuid ids", () => {
    expect(Object.keys(tables).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "ba_account",
      "ba_passkey",
      "ba_rate_limit",
      "ba_session",
      "ba_user",
      "ba_verification",
    ]);
    expect(tables.ba_user?.id).toEqual({
      type: "uuid",
      nullable: false,
      unique: true,
      indexed: true,
    });
  });

  it("makes a reference to a user a cascading uuid", () => {
    expect(tables.ba_session?.user_id).toMatchObject({
      type: "uuid",
      references: { target: "ba_user.id", onDelete: "CASCADE" },
    });
  });

  it("maps Better Auth's field types to Postgres types", () => {
    expect(tables).toMatchObject({
      ba_user: {
        email: { type: "text", unique: true, indexed: true },
        email_verified: { type: "boolean" },
        created_at: { type: "timestamp with time zone" },
        image: { nullable: true },
      },
      ba_rate_limit: { count: { type: "integer" }, last_request: { type: "bigint" } },
    });
  });

  it("applies the migration's own choices for impersonated_by", () => {
    expect(tables.ba_session?.impersonated_by).toMatchObject({
      type: "uuid",
      indexed: true,
      references: { target: "ba_user.id", onDelete: "CASCADE" },
    });
  });

  it("names a field type it has no Postgres type for, rather than guessing", () => {
    const options: BetterAuthOptions = {
      plugins: [
        {
          id: "tags",
          schema: { tag: { fields: { labels: { type: "string[]", required: true } } } },
        },
      ],
    };

    expect(expectedAuthTables(options).tag?.labels?.type).toBe("unsupported:string[]");
  });
});

describe("readAuthTables", () => {
  it("builds each column's shape from the catalog's columns, indexes and foreign keys", async () => {
    const { db, queries } = scriptedDb<unknown>((query) => {
      if (query.sql.includes("information_schema.columns")) {
        return [
          { table: "ba_user", column: "id", type: "uuid", nullable: "NO" },
          { table: "ba_user", column: "image", type: "text", nullable: "YES" },
          { table: "ba_session", column: "user_id", type: "uuid", nullable: "NO" },
          { table: "ba_session", column: "token", type: "text", nullable: "NO" },
          { table: "ba_session", column: "lead", type: "uuid", nullable: "NO" },
        ];
      }
      if (query.sql.includes("pg_index")) {
        return [
          { table: "ba_user", column: "id", unique: true, width: 1 },
          { table: "ba_session", column: "user_id", unique: false, width: 1 },
          // Unique only together with another column: not a unique column.
          { table: "ba_session", column: "token", unique: true, width: 2 },
        ];
      }
      return [
        { table: "ba_session", column: "user_id", target: "ba_user.id", rule: "c" },
        { table: "ba_session", column: "lead", target: "ba_user.id", rule: "?" },
      ];
    });

    expect(await readAuthTables(db, "app")).toEqual({
      ba_user: {
        id: { type: "uuid", nullable: false, unique: true, indexed: true },
        image: { type: "text", nullable: true, unique: false, indexed: false },
      },
      ba_session: {
        user_id: {
          type: "uuid",
          nullable: false,
          unique: false,
          indexed: true,
          references: { target: "ba_user.id", onDelete: "CASCADE" },
        },
        token: { type: "text", nullable: false, unique: false, indexed: true },
        lead: {
          type: "uuid",
          nullable: false,
          unique: false,
          indexed: false,
          references: { target: "ba_user.id", onDelete: "?" },
        },
      },
    });
    expect(queries.map((query) => query.parameters)).toEqual([["app"], ["app"], ["app"]]);
  });
});
