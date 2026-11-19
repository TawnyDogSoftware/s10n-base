import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import {
  MigrationFailedError,
  checkMigrationResults,
  parseMigrationCommand,
  runMigrationCommand,
} from "./migrator";

describe("parseMigrationCommand", () => {
  it("defaults to up", () => {
    expect(parseMigrationCommand([])).toBe("up");
  });

  it.each(["up", "status", "down", "reset"])("accepts %s", (command) => {
    expect(parseMigrationCommand([command])).toBe(command);
  });

  it("rejects anything else with the usage", () => {
    expect(() => parseMigrationCommand(["seed"])).toThrow("Usage: migrate [up|status|down|reset]");
    expect(() => parseMigrationCommand(["up", "extra"])).toThrow(/^Usage/);
  });
});

describe("runMigrationCommand", () => {
  // Never reached: the production check runs before any query.
  const db = {} as Kysely<unknown>;

  it.each(["down", "reset"] as const)("refuses %s when NODE_ENV is production", async (command) => {
    const log = vi.fn();

    await expect(
      runMigrationCommand(command, {
        db,
        nodeEnv: "production",
        schema: "public",
        migrations: {},
        log,
      }),
    ).rejects.toThrow(`"${command}" refuses to run when NODE_ENV is production`);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("checkMigrationResults", () => {
  it("returns the names that ran", () => {
    expect(
      checkMigrationResults({
        results: [
          { migrationName: "001_a", direction: "Up", status: "Success" },
          { migrationName: "002_b", direction: "Up", status: "Success" },
        ],
      }),
    ).toEqual(["001_a", "002_b"]);
  });

  it("throws the migration's own error as the cause, naming the migration", () => {
    const cause = new Error('relation "missing" does not exist');

    let thrown: unknown;
    try {
      checkMigrationResults({
        error: cause,
        results: [
          { migrationName: "001_a", direction: "Up", status: "Success" },
          { migrationName: "002_b", direction: "Up", status: "Error" },
          { migrationName: "003_c", direction: "Up", status: "NotExecuted" },
        ],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationFailedError);
    expect((thrown as Error).message).toBe("Migration 002_b failed.");
    expect((thrown as Error).cause).toBe(cause);
  });

  it("throws when the run failed before any migration", () => {
    expect(() => checkMigrationResults({ error: new Error("lock") })).toThrow(
      "Migration run failed.",
    );
  });
});
