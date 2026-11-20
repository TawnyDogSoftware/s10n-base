import { describe, expect, it } from "vitest";

import { scriptedDb } from "../../test/scripted-db";
import type { DB } from "./generated/db";
import { joinableTransactions } from "./transactions";

function setup() {
  const scripted = scriptedDb<DB>(() => [{ name: "Robin" }]);
  return { ...scripted, ...joinableTransactions(scripted.db) };
}

describe("joinableTransactions", () => {
  it("is the plain database outside a transaction", async () => {
    const { joinable, queries } = setup();

    expect(joinable.isTransaction).toBe(false);
    expect(await joinable.selectFrom("ba_user").select("name").execute()).toEqual([
      { name: "Robin" },
    ]);
    expect(queries).toHaveLength(1);
  });

  it("runs queries made through the joinable database on the open transaction", async () => {
    const { joinable, transaction, queries } = setup();

    const result = await transaction(async (trx) => {
      expect(trx.isTransaction).toBe(true);
      expect(joinable.isTransaction).toBe(true);
      return joinable.selectFrom("ba_user").select("name").executeTakeFirst();
    });

    expect(result).toEqual({ name: "Robin" });
    expect(queries).toHaveLength(1);
  });

  it("keeps what a getter returns, binds methods, and passes on what is missing", async () => {
    const { joinable, transaction, queries } = setup();
    const countUsers = () =>
      joinable.selectFrom("ba_user").select(joinable.fn.count("id").as("users")).execute();

    await countUsers();
    await transaction(countUsers);

    expect(queries.map((query) => query.sql)).toEqual([
      'select count("id") as "users" from "ba_user"',
      'select count("id") as "users" from "ba_user"',
    ]);
    expect(Reflect.get(joinable, "missing")).toBeUndefined();
  });

  it("goes back to the plain database for work that outlives the transaction", async () => {
    const { joinable, transaction } = setup();
    let open: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let afterwards: Promise<boolean> | undefined;

    await transaction(() => {
      // Continues in the transaction's async context, but only after it has ended.
      afterwards = gate.then(() => joinable.isTransaction);
      return Promise.resolve();
    });
    open?.();

    expect(await afterwards).toBe(false);
  });

  it("passes the work's failure on", async () => {
    const { transaction } = setup();

    await expect(transaction(() => Promise.reject(new Error("work failed")))).rejects.toThrow(
      "work failed",
    );
  });
});
