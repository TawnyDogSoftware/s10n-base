/**
 * The order of the auth migration's statements, which Postgres enforces through the foreign
 * keys. What the tables hold is checked against Better Auth by auth/schema.live.test.ts.
 */
import { describe, expect, it } from "vitest";

import { scriptedDb } from "../../../test/scripted-db";
import { migrations } from "./index";

async function statements(direction: "up" | "down"): Promise<string[]> {
  const { db, queries } = scriptedDb<unknown>(() => []);
  const migration = migrations["001_auth"];
  await (direction === "up" ? migration?.up(db) : migration?.down?.(db));
  return queries.map((query) => query.sql);
}

const created = (sql: string) => /^create (?:table|index) "([^"]+)"/.exec(sql)?.[1];

describe("001_auth", () => {
  it("creates the user table first, then the tables that reference it, then their indexes", async () => {
    const names = (await statements("up")).map(created);

    expect(names).toEqual([
      "ba_user",
      "ba_session",
      "ba_account",
      "ba_verification",
      "ba_rate_limit",
      "ba_passkey",
      "ba_session_user_id_idx",
      "ba_session_impersonated_by_idx",
      "ba_account_user_id_idx",
      "ba_verification_identifier_idx",
      "ba_passkey_user_id_idx",
      "ba_passkey_credential_id_idx",
    ]);
  });

  it("drops every table, the user table last", async () => {
    expect(await statements("down")).toEqual([
      'drop table "ba_passkey"',
      'drop table "ba_rate_limit"',
      'drop table "ba_verification"',
      'drop table "ba_account"',
      'drop table "ba_session"',
      'drop table "ba_user"',
    ]);
  });
});
