import { type ColumnDefinitionBuilder, type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

const id = (column: ColumnDefinitionBuilder) =>
  column.primaryKey().defaultTo(sql`gen_random_uuid()`);
const required = (column: ColumnDefinitionBuilder) => column.notNull();
const now = (column: ColumnDefinitionBuilder) => column.notNull().defaultTo(sql`now()`);
const ownedByUser = (column: ColumnDefinitionBuilder) =>
  column.notNull().references("ba_user.id").onDelete("cascade");

/**
 * Better Auth's tables for the options in `auth/options.ts`: `ba_*` names, snake_case columns,
 * `uuid` keys that Postgres generates (Better Auth's `uuid` setting leaves the id to the
 * database), and `timestamptz` times. The admin plugin's columns are on `ba_user` and
 * `ba_session`, the passkey plugin's table is `ba_passkey`.
 *
 * Deleting a user deletes their sessions, accounts and passkeys, and also the sessions they
 * started by impersonating someone else: those end with the admin who started them, rather than
 * passing to the user being impersonated.
 *
 * `auth/schema.live.test.ts` checks every table, column, type, nullability and unique column
 * against what Better Auth expects for these exact options.
 */
export const auth: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("ba_user")
      .addColumn("id", "uuid", id)
      .addColumn("name", "text", required)
      .addColumn("email", "text", (column) => column.notNull().unique())
      .addColumn("email_verified", "boolean", (column) => column.notNull().defaultTo(false))
      .addColumn("image", "text")
      .addColumn("role", "text")
      .addColumn("banned", "boolean", (column) => column.defaultTo(false))
      .addColumn("ban_reason", "text")
      .addColumn("ban_expires", "timestamptz")
      .addColumn("created_at", "timestamptz", now)
      .addColumn("updated_at", "timestamptz", now)
      .execute();

    await db.schema
      .createTable("ba_session")
      .addColumn("id", "uuid", id)
      .addColumn("user_id", "uuid", ownedByUser)
      .addColumn("token", "text", (column) => column.notNull().unique())
      .addColumn("expires_at", "timestamptz", required)
      .addColumn("ip_address", "text")
      .addColumn("user_agent", "text")
      .addColumn("impersonated_by", "uuid", (column) =>
        column.references("ba_user.id").onDelete("cascade"),
      )
      .addColumn("created_at", "timestamptz", now)
      .addColumn("updated_at", "timestamptz", now)
      .execute();

    await db.schema
      .createTable("ba_account")
      .addColumn("id", "uuid", id)
      .addColumn("user_id", "uuid", ownedByUser)
      .addColumn("account_id", "text", required)
      .addColumn("provider_id", "text", required)
      .addColumn("access_token", "text")
      .addColumn("refresh_token", "text")
      .addColumn("id_token", "text")
      .addColumn("access_token_expires_at", "timestamptz")
      .addColumn("refresh_token_expires_at", "timestamptz")
      .addColumn("scope", "text")
      .addColumn("password", "text")
      .addColumn("created_at", "timestamptz", now)
      .addColumn("updated_at", "timestamptz", now)
      .addUniqueConstraint("ba_account_provider_account_key", ["provider_id", "account_id"])
      .execute();

    await db.schema
      .createTable("ba_verification")
      .addColumn("id", "uuid", id)
      .addColumn("identifier", "text", required)
      .addColumn("value", "text", required)
      .addColumn("expires_at", "timestamptz", required)
      .addColumn("created_at", "timestamptz", now)
      .addColumn("updated_at", "timestamptz", now)
      .execute();

    await db.schema
      .createTable("ba_rate_limit")
      .addColumn("id", "uuid", id)
      .addColumn("key", "text", (column) => column.notNull().unique())
      .addColumn("count", "integer", required)
      .addColumn("last_request", "bigint", required)
      .execute();

    await db.schema
      .createTable("ba_passkey")
      .addColumn("id", "uuid", id)
      .addColumn("user_id", "uuid", ownedByUser)
      .addColumn("name", "text")
      .addColumn("public_key", "text", required)
      .addColumn("credential_id", "text", required)
      .addColumn("counter", "integer", required)
      .addColumn("device_type", "text", required)
      .addColumn("backed_up", "boolean", required)
      .addColumn("transports", "text")
      .addColumn("aaguid", "text")
      .addColumn("created_at", "timestamptz", (column) => column.defaultTo(sql`now()`))
      .execute();

    // The lookups Better Auth makes. The unique columns above already have their indexes.
    await db.schema
      .createIndex("ba_session_user_id_idx")
      .on("ba_session")
      .column("user_id")
      .execute();
    await db.schema
      .createIndex("ba_session_impersonated_by_idx")
      .on("ba_session")
      .column("impersonated_by")
      .execute();
    await db.schema
      .createIndex("ba_account_user_id_idx")
      .on("ba_account")
      .column("user_id")
      .execute();
    await db.schema
      .createIndex("ba_verification_identifier_idx")
      .on("ba_verification")
      .column("identifier")
      .execute();
    await db.schema
      .createIndex("ba_passkey_user_id_idx")
      .on("ba_passkey")
      .column("user_id")
      .execute();
    await db.schema
      .createIndex("ba_passkey_credential_id_idx")
      .on("ba_passkey")
      .column("credential_id")
      .execute();
  },
  async down(db: Kysely<unknown>) {
    // Children before the user table they reference.
    await db.schema.dropTable("ba_passkey").execute();
    await db.schema.dropTable("ba_rate_limit").execute();
    await db.schema.dropTable("ba_verification").execute();
    await db.schema.dropTable("ba_account").execute();
    await db.schema.dropTable("ba_session").execute();
    await db.schema.dropTable("ba_user").execute();
  },
};
