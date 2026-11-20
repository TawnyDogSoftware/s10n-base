/**
 * The two-role setup in docs/deployment.md: `migrate` connects as the role that owns the schema
 * and grants `DATABASE_APP_ROLE` what the server needs; the server connects as that role, which
 * reads and writes rows but cannot change the schema, and keeps working when a later migration
 * adds a table.
 */
import { randomBytes } from "node:crypto";

import type { Kysely } from "kysely";
import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrateCli } from "../../migrate-cli";
import { startAuthServer, TestClient, verifyPath, type AuthServer } from "../../test/auth-server";
import { connectToTestDatabase, fixtureSchemaName } from "../../test/live-database";
import type { DB } from "./generated/db";
import { migrations } from "./migrations";
import { createDb, createPool } from "./pool";

interface Role {
  readonly name: string;
  readonly url: string;
}

const PASSWORD = "correct horse battery staple";

let admin: Client;
let schema: string;
let owner: Role;
let appRole: Role;
let app: AuthServer;
const created: string[] = [];

/** Creates a login role with a random password; returns its name and a URL that signs in as it. */
async function createRole(baseUrl: string, name: string): Promise<Role> {
  const password = randomBytes(18).toString("hex");
  // Both are plain lowercase identifiers and hex, so quoting them is enough.
  await admin.query(`create role "${name}" login password '${password}'`);
  created.push(name);
  const url = new URL(baseUrl);
  url.username = name;
  url.password = password;
  return { name, url: url.toString() };
}

function migrate(env: Record<string, string>, list = migrations) {
  return runMigrateCli({ args: ["up"], env, schema, migrations: list, write: () => {} });
}

/** A one-connection client signed in as `role`, working in the fixture schema. */
async function connectAs(role: Role): Promise<Client> {
  const client = new Client({ connectionString: role.url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  await client.query(`set search_path to "${schema}"`);
  return client;
}

beforeAll(async () => {
  const connected = await connectToTestDatabase();
  admin = connected.client;
  schema = fixtureSchemaName();
  owner = await createRole(connected.target.url, `${schema}_owner`);
  appRole = await createRole(connected.target.url, `${schema}_app`);
  await admin.query(`create schema "${schema}" authorization "${owner.name}"`);

  expect(
    await migrate({
      MIGRATION_DATABASE_URL: owner.url,
      DATABASE_URL: appRole.url,
      DATABASE_APP_ROLE: appRole.name,
    }),
  ).toBe(0);

  app = await startAuthServer({
    createSchema: () => {
      const db: Kysely<DB> = createDb(
        createPool({
          connectionString: appRole.url,
          max: 2,
          searchPath: schema,
          onIdleError: () => {},
        }),
      );
      return Promise.resolve({
        fixture: { url: appRole.url, schema, admin, drop: () => Promise.resolve() },
        db,
        drop: () => db.destroy(),
      });
    },
  });
});

afterAll(async () => {
  try {
    await app.stop();
  } finally {
    await admin.query(`drop schema if exists "${schema}" cascade`);
    for (const name of created) {
      await admin.query(`drop owned by "${name}"`);
      await admin.query(`drop role if exists "${name}"`);
    }
    await admin.end();
  }
});

describe("a server connected as the app role", () => {
  it("is ready, and signs up, verifies and signs in a user", async () => {
    const browser = new TestClient(app.base, "198.51.100.1");
    const address = `two-roles-${randomBytes(4).toString("hex")}@example.com`;

    expect((await browser.get("/ready")).status).toBe(200);
    expect(
      (
        await browser.post("/api/auth/sign-up/email", {
          name: "Two Roles",
          email: address,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    const [message] = await app.emailsTo(address);
    expect((await browser.get(verifyPath(message))).status).toBe(200);
    expect(
      (await browser.post("/api/auth/sign-in/email", { email: address, password: PASSWORD }))
        .status,
    ).toBe(200);
    expect(await browser.session()).toMatchObject({ email: address, emailVerified: true });
  });
});

describe("the app role", () => {
  it.each([
    ["create a table", "create table intruder (id int)", /permission denied for schema/],
    ["drop a table", "drop table ba_user", /must be owner of table ba_user/],
    [
      "alter a table",
      "alter table ba_user add column intruder int",
      /must be owner of table ba_user/,
    ],
    ["truncate a table", "truncate ba_session", /permission denied for table ba_session/],
    [
      "touch the migrator's records",
      "delete from kysely_migration",
      /permission denied for table kysely_migration/,
    ],
  ])("cannot %s", async (_what, statement, refusal) => {
    const client = await connectAs(appRole);
    try {
      await expect(client.query(statement)).rejects.toThrow(refusal);
    } finally {
      await client.end();
    }
  });

  it("can use a table a later migration adds, with no grant by hand", async () => {
    const later = {
      ...migrations,
      "002_widget": {
        up: async (db: Kysely<unknown>) => {
          await sql`create table widget (id int primary key, name text not null)`.execute(db);
        },
      },
    };
    // Without DATABASE_APP_ROLE: the default privileges set by the first run cover the new table.
    expect(await migrate({ MIGRATION_DATABASE_URL: owner.url }, later)).toBe(0);

    const client = await connectAs(appRole);
    try {
      await client.query("insert into widget (id, name) values (1, 'first')");
      await client.query("update widget set name = 'renamed' where id = 1");
      const { rows } = await client.query("select name from widget");
      expect(rows).toEqual([{ name: "renamed" }]);
      await client.query("delete from widget");
    } finally {
      await client.end();
    }
  });
});
