import { getMigrations } from "better-auth/db/migration";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { migrateDown } from "../infra/postgres/migrator";
import { migrations } from "../infra/postgres/migrations";
import { createLogger } from "../observability/logger";
import { createMigratedSchema, type MigratedSchema } from "../test/auth-database";
import type { AuthEmailSender } from "./email/sender";
import { buildAuthOptions } from "./options";
import { authSchemaDifferences, expectedAuthTables, readAuthTables } from "./schema-check";

let schema: MigratedSchema;

function options() {
  return buildAuthOptions(
    {
      appName: "S10N Base",
      appOrigin: "http://localhost:5173",
      nodeEnv: "test",
      appVariant: "development",
      secret: "a-test-secret-that-is-at-least-32-characters",
      logLevel: "error",
    },
    {
      db: schema.db,
      emailSender: {
        sendVerificationEmail: vi.fn<AuthEmailSender["sendVerificationEmail"]>(),
        sendPasswordResetEmail: vi.fn<AuthEmailSender["sendPasswordResetEmail"]>(),
      },
      logger: createLogger({ level: "error", write: () => {} }),
    },
  );
}

beforeAll(async () => {
  schema = await createMigratedSchema();
});

afterAll(async () => {
  await schema.drop();
});

describe("the auth migration against Better Auth's schema", () => {
  it("has every table, column, type, nullability, unique column, index and foreign key Better Auth expects for our options, and nothing else", async () => {
    const actual = await readAuthTables(schema.db as Kysely<unknown>, schema.fixture.schema);

    expect(Object.keys(actual).toSorted()).toEqual([
      "ba_account",
      "ba_passkey",
      "ba_rate_limit",
      "ba_session",
      "ba_user",
      "ba_verification",
    ]);
    expect(authSchemaDifferences(expectedAuthTables(options()), actual)).toEqual([]);
  });

  it("leaves Better Auth's own migration planner nothing to do", async () => {
    const plan = await getMigrations(options(), { throwOnUnsafe: false });

    expect({
      toBeCreated: plan.toBeCreated,
      toBeAdded: plan.toBeAdded,
      toBeAddedIndexes: plan.toBeAddedIndexes,
      unsafeChanges: plan.unsafeChanges,
      schemaProblems: plan.schemaProblems,
    }).toEqual({
      toBeCreated: [],
      toBeAdded: [],
      toBeAddedIndexes: [],
      unsafeChanges: [],
      schemaProblems: [],
    });
  });

  it("deletes a user's sessions, accounts and passkeys with them, and an admin's impersonation sessions with the admin", async () => {
    const { db } = schema;
    const user = (email: string) =>
      db
        .insertInto("ba_user")
        .values({ name: "User", email })
        .returning("id")
        .executeTakeFirstOrThrow();
    const admin = await user("admin@example.com");
    const target = await user("target@example.com");
    const session = (token: string, userId: string, impersonatedBy: string | null) =>
      db
        .insertInto("ba_session")
        .values({
          user_id: userId,
          token,
          expires_at: new Date(Date.now() + 60_000),
          impersonated_by: impersonatedBy,
        })
        .execute();
    await session("own", target.id, null);
    await session("impersonation", target.id, admin.id);
    await session("admin-own", admin.id, null);
    await db
      .insertInto("ba_account")
      .values({ user_id: admin.id, account_id: admin.id, provider_id: "credential" })
      .execute();
    await db
      .insertInto("ba_passkey")
      .values({
        user_id: admin.id,
        public_key: "key",
        credential_id: "credential",
        counter: 0,
        device_type: "singleDevice",
        backed_up: false,
      })
      .execute();

    await db.deleteFrom("ba_user").where("id", "=", admin.id).execute();

    expect(await db.selectFrom("ba_session").select("token").execute()).toEqual([{ token: "own" }]);
    expect(await db.selectFrom("ba_account").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("ba_passkey").selectAll().execute()).toEqual([]);
  });

  it("allows one account per provider and account id", async () => {
    const { db } = schema;
    const user = await db
      .insertInto("ba_user")
      .values({ name: "User", email: "accounts@example.com" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const account = () =>
      db
        .insertInto("ba_account")
        .values({ user_id: user.id, account_id: "same", provider_id: "credential" })
        .execute();

    await account();
    await expect(account()).rejects.toThrow(/duplicate key/);
  });

  it("rolls back to an empty schema", async () => {
    const target = { db: schema.db as Kysely<unknown>, schema: schema.fixture.schema, migrations };

    for (let left = Object.keys(migrations).length; left > 0; left -= 1) await migrateDown(target);

    expect(await readAuthTables(schema.db as Kysely<unknown>, schema.fixture.schema)).toEqual({});
  });
});
