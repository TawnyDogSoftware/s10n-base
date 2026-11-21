import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAppAuth } from "../../auth/instance";
import { createMigratedSchema, type MigratedSchema } from "../../test/auth-database";
import { testAuthOptions } from "../../test/auth-options";
import { joinableTransactions } from "./transactions";

let schema: MigratedSchema;

beforeAll(async () => {
  schema = await createMigratedSchema();
});

afterAll(async () => {
  await schema.drop();
});

async function newUser(): Promise<string> {
  const { id } = await schema.db
    .insertInto("ba_user")
    .values({ name: "Before", email: `joined-${crypto.randomUUID()}@example.com` })
    .returning("id")
    .executeTakeFirstOrThrow();
  return id;
}

async function nameOf(userId: string): Promise<string> {
  const row = await schema.db
    .selectFrom("ba_user")
    .select("name")
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  return row.name;
}

describe("Better Auth over a joinable database", () => {
  it("writes inside the open transaction: unseen until it commits, and gone if it rolls back", async () => {
    const { joinable, transaction } = joinableTransactions(schema.db);
    const auth = createAppAuth(testAuthOptions({}, joinable));
    const userId = await newUser();

    await expect(
      transaction(async () => {
        expect(await auth.updateUserName(userId, "Inside")).toMatchObject({ name: "Inside" });
        expect(await nameOf(userId)).toBe("Before");
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(await nameOf(userId)).toBe("Before");

    await transaction(() => auth.updateUserName(userId, "Committed"));
    expect(await nameOf(userId)).toBe("Committed");
  });

  it("is the plain database outside a transaction", async () => {
    const { joinable } = joinableTransactions(schema.db);
    const auth = createAppAuth(testAuthOptions({}, joinable));
    const userId = await newUser();

    await auth.updateUserName(userId, "Outside");

    expect(await nameOf(userId)).toBe("Outside");
  });
});
