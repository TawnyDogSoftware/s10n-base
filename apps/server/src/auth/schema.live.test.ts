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

    expect(Object.keys(actual).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "ba_account",
      "ba_passkey",
      "ba_rate_limit",
      "ba_session",
      "ba_user",
      "ba_verification",
    ]);
    expect(authSchemaDifferences(expectedAuthTables(options()), actual)).toEqual([]);
  });

  it("does not count an index left invalid or a foreign key not yet validated", async () => {
    const broken = await createMigratedSchema();
    const { admin, schema: name } = broken.fixture;
    try {
      // A unique index whose concurrent build failed on duplicates is left invalid: it enforces
      // nothing. A foreign key added NOT VALID is not checked against the rows already there.
      await admin.query(`alter table "${name}".ba_user drop constraint ba_user_email_key`);
      await admin.query(
        `insert into "${name}".ba_user (name, email) values ('One', 'twin@example.com'), ('Two', 'twin@example.com')`,
      );
      await admin
        .query(`create unique index concurrently ba_user_email_key on "${name}".ba_user (email)`)
        .catch(() => undefined);
      await admin.query(
        `alter table "${name}".ba_session drop constraint ba_session_user_id_fkey,
           add constraint ba_session_user_id_fkey foreign key (user_id)
             references "${name}".ba_user (id) on delete cascade not valid`,
      );

      const actual = await readAuthTables(broken.db as Kysely<unknown>, name);
      const problems = authSchemaDifferences(expectedAuthTables(options()), actual);

      expect(problems.some((line) => line.startsWith("ba_user.email:"))).toBe(true);
      expect(problems.some((line) => line.startsWith("ba_session.user_id:"))).toBe(true);
    } finally {
      await broken.drop();
    }
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
