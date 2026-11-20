import { describe, expect, it } from "vitest";

import type { DB } from "./infra/postgres/generated/db";
import { parseSetRoleArgs, runSetRoleCli } from "./set-role-cli";
import { scriptedDb } from "./test/scripted-db";

describe("parseSetRoleArgs", () => {
  it("reads an email and a known role", () => {
    expect(parseSetRoleArgs(["admin@example.com", "admin"])).toEqual({
      email: "admin@example.com",
      role: "admin",
    });
    expect(parseSetRoleArgs([" user@example.com ", "user"]).email).toBe("user@example.com");
  });

  it.each([[[]], [["a@example.com"]], [["a@example.com", "admin", "extra"]], [["", "admin"]]])(
    "refuses %j with the usage line",
    (args) => {
      expect(() => parseSetRoleArgs(args)).toThrow(/^usage: auth:set-role <email> <user\|admin>/);
    },
  );

  it("refuses a role the app does not know", () => {
    expect(() => parseSetRoleArgs(["a@example.com", "owner"])).toThrow(/Unknown role "owner"/);
  });
});

describe("runSetRoleCli", () => {
  it("exits 2 with the usage line for bad arguments, before touching the database", async () => {
    const lines: string[] = [];

    const code = await runSetRoleCli({
      args: ["a@example.com", "root"],
      env: {},
      write: (line) => lines.push(line),
    });

    expect(code).toBe(2);
    expect(lines.join("")).toContain("set_role_usage");
  });

  it("exits 1 when DATABASE_URL is missing", async () => {
    const lines: string[] = [];

    const code = await runSetRoleCli({
      args: ["a@example.com", "admin"],
      env: {},
      write: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(lines.join("")).toContain("DATABASE_URL");
  });
});

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  return {
    lines,
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  };
}

describe("runSetRoleCli with a database", () => {
  const env = { DATABASE_URL: "postgres://app:secret@127.0.0.1:9/app" };

  it("sets the role of the user with that email, whatever its case, and exits 0", async () => {
    const { db, queries } = scriptedDb<DB>(() => [{ id: "u1" }]);
    const output = capture();

    const code = await runSetRoleCli({
      args: ["Sam@Example.com", "admin"],
      env,
      write: output.write,
      db,
    });

    expect(code).toBe(0);
    expect(output.lines).toMatchObject([{ message: "role_set", userId: "u1", role: "admin" }]);
    expect(queries[0]?.sql).toContain("lower(email) = lower($");
    expect(queries[0]?.parameters).toContain("Sam@Example.com");
  });

  it("follows LOG_LEVEL: at error it prints no role_set line, but still prints a failure", async () => {
    const quiet = { ...env, LOG_LEVEL: "error" };
    const success = capture();
    const failure = capture();

    const set = await runSetRoleCli({
      args: ["sam@example.com", "admin"],
      env: quiet,
      write: success.write,
      db: scriptedDb<DB>(() => [{ id: "u1" }]).db,
    });
    const unknown = await runSetRoleCli({
      args: ["nobody@example.com", "admin"],
      env: quiet,
      write: failure.write,
      db: scriptedDb<DB>(() => []).db,
    });

    expect([set, unknown]).toEqual([0, 1]);
    expect(success.lines).toEqual([]);
    expect(failure.lines).toMatchObject([{ message: "set_role_failed" }]);
  });

  it("exits 1 when no user has the email", async () => {
    const { db } = scriptedDb<DB>(() => []);
    const output = capture();

    const code = await runSetRoleCli({
      args: ["nobody@example.com", "admin"],
      env,
      write: output.write,
      db,
    });

    expect(code).toBe(1);
    expect(output.lines).toMatchObject([
      { message: "set_role_failed", error: { message: "No user has that email address." } },
    ]);
  });

  it("exits 1 when the database cannot be reached", async () => {
    const output = capture();

    const code = await runSetRoleCli({
      args: ["sam@example.com", "admin"],
      env,
      write: output.write,
    });

    expect(code).toBe(1);
    expect(output.lines).toMatchObject([{ message: "set_role_failed" }]);
    expect(JSON.stringify(output.lines)).not.toContain("secret");
  });
});
