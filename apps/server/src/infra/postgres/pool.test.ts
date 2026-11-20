import { describe, expect, it, vi } from "vitest";

import { createPool, warnOnIdleError, withSearchPath } from "./pool";

const URL = "postgres://app:pw@127.0.0.1:5432/app";

describe("withSearchPath", () => {
  it("leaves the URL alone without a search path", () => {
    expect(withSearchPath(URL, undefined)).toBe(URL);
  });

  it("adds search_path to the connection options", () => {
    const url = new globalThis.URL(withSearchPath(URL, "fixture_abc"));

    expect(url.searchParams.get("options")).toBe("-c search_path=fixture_abc");
  });

  it("keeps options already in the URL and sets search_path last", () => {
    const url = new globalThis.URL(
      withSearchPath(`${URL}?options=${encodeURIComponent("-c work_mem=4MB")}`, "s"),
    );

    expect(url.searchParams.get("options")).toBe("-c work_mem=4MB -c search_path=s");
  });

  it.each(["Fixture", "a b", "a,b", "a;drop", "1abc", "", "a-b"])(
    "rejects %j, which is not one lowercase identifier",
    (searchPath) => {
      expect(() => withSearchPath(URL, searchPath)).toThrow(/single lowercase identifier/);
    },
  );
});

describe("createPool", () => {
  it("sets the pool size and the timeouts", () => {
    const pool = createPool({ connectionString: URL, max: 7, onIdleError: () => {} });

    expect(pool.options).toMatchObject({
      max: 7,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
    void pool.end();
  });

  it("reports an idle connection's error instead of crashing", () => {
    const onIdleError = vi.fn<(error: Error) => void>();
    const pool = createPool({ connectionString: URL, max: 1, onIdleError });

    // With no listener, an "error" event would throw and take the process down.
    pool.emit("error", new Error("terminating connection due to administrator command"));

    expect(onIdleError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "terminating connection due to administrator command" }),
    );
    void pool.end();
  });
});

describe("warnOnIdleError", () => {
  it("logs an idle connection's failure as a warning", () => {
    const warn = vi.fn<(message: string, fields?: Readonly<Record<string, unknown>>) => void>();
    const error = new Error("terminating connection due to administrator command");

    warnOnIdleError({ warn })(error);

    expect(warn).toHaveBeenCalledWith("database_idle_connection_failed", { error });
  });
});
