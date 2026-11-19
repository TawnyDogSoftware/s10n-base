import { describe, expect, it } from "vitest";

import {
  assertConnectedToTestDatabase,
  fixtureSchemaCreatedAt,
  fixtureSchemaName,
  testDatabaseUrl,
} from "./live-database";

describe("testDatabaseUrl", () => {
  it("requires TEST_DATABASE_URL", () => {
    expect(() => testDatabaseUrl({})).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("never falls back to DATABASE_URL", () => {
    expect(() => testDatabaseUrl({ DATABASE_URL: "postgres://u:p@localhost/app_test" })).toThrow(
      /TEST_DATABASE_URL is not set/,
    );
  });

  it("requires a database name ending in _test", () => {
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost/app" })).toThrow(
      /must end in _test/,
    );
    expect(() =>
      testDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost/app_test_copy" }),
    ).toThrow(/must end in _test/);
  });

  it("does not quote the URL, which holds a password, in its errors", () => {
    expect(() =>
      testDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:hunter2@localhost/app" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("hunter2") }));
  });

  it("returns the URL and the database name", () => {
    expect(
      testDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost:5432/app_test" }),
    ).toEqual({
      url: "postgres://u:p@localhost:5432/app_test",
      database: "app_test",
    });
  });
});

function client(currentDatabase: string) {
  return {
    query: () => Promise.resolve({ rows: [{ current_database: currentDatabase }] }),
  };
}

describe("assertConnectedToTestDatabase", () => {
  it("passes when the open connection is on the expected database", async () => {
    await expect(
      assertConnectedToTestDatabase(client("app_test"), "app_test"),
    ).resolves.toBeUndefined();
  });

  it("refuses when the server put the connection on another database", async () => {
    await expect(assertConnectedToTestDatabase(client("app"), "app_test")).rejects.toThrow(
      /connected to app, not app_test/,
    );
  });

  it("refuses a database whose name does not end in _test, even if it matches", async () => {
    await expect(assertConnectedToTestDatabase(client("app"), "app")).rejects.toThrow(/_test/);
  });
});

describe("fixture schema names", () => {
  it("are lowercase identifiers that record when they were made", () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const name = fixtureSchemaName(now);

    expect(name).toMatch(/^fixture_[a-z0-9]+_[a-f0-9]{12}$/);
    expect(fixtureSchemaCreatedAt(name)).toBe(now);
  });

  it("are unique", () => {
    expect(fixtureSchemaName(1)).not.toBe(fixtureSchemaName(1));
  });

  it("are recognised only in their own format", () => {
    expect(fixtureSchemaCreatedAt("public")).toBeUndefined();
    expect(fixtureSchemaCreatedAt("fixture_x")).toBeUndefined();
    expect(fixtureSchemaCreatedAt("fixture_zz_123")).toBeUndefined();
  });
});
