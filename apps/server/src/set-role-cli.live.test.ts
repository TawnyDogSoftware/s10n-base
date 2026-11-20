import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMigratedSchema, type MigratedSchema } from "./test/auth-database";
import { runSetRoleCli } from "./set-role-cli";

let schema: MigratedSchema;

beforeEach(async () => {
  schema = await createMigratedSchema();
});

afterEach(async () => {
  await schema.drop();
});

async function run(args: string[]) {
  const lines: string[] = [];
  const code = await runSetRoleCli({
    args,
    env: { DATABASE_URL: schema.fixture.url },
    schema: schema.fixture.schema,
    write: (line) => lines.push(line),
  });
  return { code, output: lines.join("") };
}

describe("auth:set-role against Postgres", () => {
  it("sets the role of the user with that email, whatever its case", async () => {
    const user = await schema.db
      .insertInto("ba_user")
      .values({ name: "Admin", email: "admin@example.com", role: "user" })
      .returning("id")
      .executeTakeFirstOrThrow();

    const result = await run(["Admin@Example.com", "admin"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("role_set");
    const row = await schema.db
      .selectFrom("ba_user")
      .select("role")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    expect(row.role).toBe("admin");
  });

  it("refuses an email no user has", async () => {
    const result = await run(["nobody@example.com", "admin"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("UnknownUserError");
  });

  it("refuses an email several users share in different case, and changes none of them", async () => {
    // Better Auth stores addresses in lower case, but an import of existing users may not.
    await schema.db
      .insertInto("ba_user")
      .values([
        { name: "Lower", email: "sam@example.com", role: "user" },
        { name: "Upper", email: "Sam@Example.com", role: "user" },
      ])
      .execute();

    const result = await run(["sam@example.com", "admin"]);

    expect(result.code).toBe(1);
    expect(result.output).toContain("AmbiguousUserError");
    const roles = await schema.db.selectFrom("ba_user").select("role").execute();
    expect(roles.map((row) => row.role)).toEqual(["user", "user"]);
  });
});
