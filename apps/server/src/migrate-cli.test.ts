import { Schedule } from "effect";
import { describe, expect, it } from "vitest";

import { runMigrateCli } from "./migrate-cli";
import { scriptedDb } from "./test/scripted-db";

function capture() {
  const lines: string[] = [];
  return {
    write: (line: string) => {
      lines.push(line);
    },
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => lines.join(""),
  };
}

// Nothing listens on port 9 (discard) on 127.0.0.1, so connections are refused at once.
const UNREACHABLE = "postgres://app:hunter2-secret@127.0.0.1:9/app";

describe("runMigrateCli", () => {
  it("rejects an unknown command with the usage, exit code 1", async () => {
    const output = capture();

    const code = await runMigrateCli({ args: ["seed"], env: {}, write: output.write });

    expect(code).toBe(1);
    expect(output.entries()).toEqual([
      expect.objectContaining({
        level: "error",
        message: "migrate_usage",
        usage: "Usage: migrate [up|status|down|reset]",
      }),
    ]);
  });

  it("reports every config problem in one line, exit code 1", async () => {
    const output = capture();

    const code = await runMigrateCli({ args: [], env: { NODE_ENV: "x" }, write: output.write });

    expect(code).toBe(1);
    expect(output.entries()).toHaveLength(1);
    expect(output.entries()[0]).toMatchObject({ level: "error", message: "config_invalid" });
    expect(output.text()).toContain("NODE_ENV");
    expect(output.text()).toContain("DATABASE_URL");
  });

  it.each(["down", "reset"])("refuses %s in production without connecting", async (command) => {
    const output = capture();

    const code = await runMigrateCli({
      args: [command],
      env: { NODE_ENV: "production", DATABASE_URL: UNREACHABLE },
      write: output.write,
    });

    expect(code).toBe(1);
    expect(output.entries()).toMatchObject([
      {
        message: "migrate_refused",
        error: { message: `"${command}" refuses to run when NODE_ENV is production.` },
      },
    ]);
  });

  it("retries an unreachable database on the schedule, then fails without printing the password", async () => {
    const output = capture();

    const code = await runMigrateCli({
      args: ["up"],
      env: { DATABASE_URL: UNREACHABLE },
      write: output.write,
      schedule: Schedule.recurs(2),
      schema: "fixture_schema",
    });

    expect(code).toBe(1);
    const messages = output.entries().map((entry) => entry.message);
    expect(messages).toEqual([
      "database_unavailable",
      "database_unavailable",
      "database_unavailable",
      "migrate_failed",
    ]);
    expect(output.text()).not.toContain("hunter2-secret");
  });
});

describe("runMigrateCli with a database", () => {
  const env = { DATABASE_URL: "postgres://app:secret@127.0.0.1:9/app" };

  it("applies the committed migrations and exits 0", async () => {
    const output = capture();
    const { db, queries } = scriptedDb<unknown>(() => []);

    const code = await runMigrateCli({ args: ["up"], env, write: output.write, db });

    expect(code).toBe(0);
    expect(output.entries()).toMatchObject([
      { message: "migrations_applied", schema: "public", applied: ["001_auth"] },
    ]);
    expect(queries.some((query) => query.sql.startsWith('create table "ba_user"'))).toBe(true);
  });

  it("runs the given migrations in the given schema", async () => {
    const output = capture();
    const { db } = scriptedDb<unknown>(() => []);

    const code = await runMigrateCli({
      args: ["status"],
      env,
      write: output.write,
      db,
      schema: "fixture_schema",
      migrations: { "001_widget": { up: () => Promise.resolve() } },
    });

    expect(code).toBe(0);
    expect(output.entries()).toMatchObject([
      { message: "migration_status", schema: "fixture_schema", pending: ["001_widget"] },
    ]);
  });
});
