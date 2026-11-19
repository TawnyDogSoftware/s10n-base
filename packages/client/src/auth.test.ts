import { describe, expect, it } from "vitest";

import { runAuthAction, trackNetworkFailures } from "./auth";
import { NetworkError } from "./transport";

describe("runAuthAction", () => {
  it("passes a success through as data", async () => {
    const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));

    await expect(
      runAuthAction(tracker, () => Promise.resolve({ data: { user: 1 }, error: null })),
    ).resolves.toEqual({ ok: true, data: { user: 1 } });
  });

  it("throws a NetworkError when a request failed even if the client turned it into a result", async () => {
    // The passkey client catches every error from its last request and reports a cancellation.
    const tracker = trackNetworkFailures(() => Promise.reject(new TypeError("Failed to fetch")));
    const swallowing = async () => {
      await tracker.fetch("https://api.example.com/x").catch(() => undefined);
      return { data: null, error: { code: "AUTH_CANCELLED", status: 400 } };
    };

    await expect(runAuthAction(tracker, swallowing)).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws a NetworkError when the client throws after a request failed", async () => {
    const tracker = trackNetworkFailures(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(
      runAuthAction(tracker, () =>
        tracker.fetch("https://api.example.com/x").then(() => ({
          data: null,
          error: null,
        })),
      ),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("rethrows an error that is not a network failure", async () => {
    const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));
    const failure = new Error("bug");

    await expect(runAuthAction(tracker, () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it("does not count an abort as a network failure", async () => {
    const tracker = trackNetworkFailures(() =>
      Promise.reject(new DOMException("aborted", "AbortError")),
    );
    const action = async () => {
      await tracker.fetch("https://api.example.com/x").catch(() => undefined);
      return { data: null, error: { code: "AUTH_CANCELLED", status: 400 } };
    };

    await expect(runAuthAction(tracker, action)).resolves.toEqual({
      ok: false,
      code: "AUTH_CANCELLED",
      status: 400,
    });
  });

  it("gives an unknown code when Better Auth sends none", async () => {
    const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));

    await expect(
      runAuthAction(tracker, () => Promise.resolve({ data: null, error: { status: 400 } })),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN", status: 400 });
  });

  it("names a rate limit RATE_LIMITED", async () => {
    const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));

    await expect(
      runAuthAction(tracker, () => Promise.resolve({ data: null, error: { status: 429 } })),
    ).resolves.toEqual({ ok: false, code: "RATE_LIMITED", status: 429 });
  });

  it.each([502, 503, 504])(
    "treats a proxy's %i without a code as a lost answer",
    async (status) => {
      const tracker = trackNetworkFailures(() => Promise.resolve(new Response()));

      await expect(
        runAuthAction(tracker, () => Promise.resolve({ data: null, error: { status } })),
      ).rejects.toBeInstanceOf(NetworkError);
    },
  );
});
