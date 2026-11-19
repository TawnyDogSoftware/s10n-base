import { Effect, Exit, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DatabaseUnavailableError, isTransientConnectionError, waitForDatabase } from "./connect";

function errorWithCode(code: string) {
  return Object.assign(new Error(code), { code });
}

describe("isTransientConnectionError", () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "57P03", "53300"])(
    "retries %s",
    (code) => {
      expect(isTransientConnectionError(errorWithCode(code))).toBe(true);
    },
  );

  it("retries a connection error with no code, such as a connect timeout", () => {
    expect(isTransientConnectionError(new Error("timeout expired"))).toBe(true);
  });

  it.each(["28P01", "3D000", "42P01"])("does not retry Postgres error %s", (code) => {
    expect(isTransientConnectionError(errorWithCode(code))).toBe(false);
  });
});

describe("waitForDatabase", () => {
  const fastRetry = Schedule.recurs(3);

  it("retries the first connection on the schedule until it succeeds", async () => {
    const ping = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(errorWithCode("ECONNREFUSED"))
      .mockRejectedValueOnce(errorWithCode("57P03"))
      .mockResolvedValue(undefined);
    const onAttemptFailed = vi.fn<(error: unknown) => void>();

    await Effect.runPromise(waitForDatabase(ping, { schedule: fastRetry, onAttemptFailed }));

    expect(ping).toHaveBeenCalledTimes(3);
    expect(onAttemptFailed).toHaveBeenCalledTimes(2);
  });

  it("gives up when the schedule ends, with the last error as the cause", async () => {
    const last = errorWithCode("ECONNREFUSED");
    const ping = vi.fn<() => Promise<void>>().mockRejectedValue(last);

    const exit = await Effect.runPromiseExit(waitForDatabase(ping, { schedule: fastRetry }));

    expect(ping).toHaveBeenCalledTimes(4);
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error
      : undefined;
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as DatabaseUnavailableError).cause).toBe(last);
  });

  it("does not retry an error that waiting cannot fix", async () => {
    const ping = vi.fn<() => Promise<void>>().mockRejectedValue(errorWithCode("28P01"));

    const exit = await Effect.runPromiseExit(waitForDatabase(ping, { schedule: fastRetry }));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
