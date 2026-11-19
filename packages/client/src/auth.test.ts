import { describe, expect, it } from "vitest";

import { runAuthAction, trackNetworkFailures } from "./auth";
import { NetworkError } from "./transport";

/** A fetch whose headers arrive and whose body stream then fails. */
function bodyLostFetch() {
  return Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"status":'));
          controller.error(new TypeError("Network connection was lost"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

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

  it("throws a NetworkError when the connection drops while the answer's body is read", async () => {
    // The headers arrived, so fetch resolved; then the body stream failed.
    const tracker = trackNetworkFailures(bodyLostFetch);
    const action = async () => {
      const response = await tracker.fetch("https://api.example.com/reset-password");
      return { data: (await response.json()) as unknown, error: null };
    };

    await expect(runAuthAction(tracker, action)).rejects.toBeInstanceOf(NetworkError);
  });

  it("passes a complete answer through with its status and headers", async () => {
    const tracker = trackNetworkFailures(() =>
      Promise.resolve(
        new Response('{"ok":1}', {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json", "x-test": "kept" },
        }),
      ),
    );

    const response = await tracker.fetch("https://api.example.com/x");

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-test")).toBe("kept");
    await expect(response.json()).resolves.toEqual({ ok: 1 });
    expect(tracker.failures()).toBe(0);
  });

  it("passes an answer with no body through", async () => {
    const tracker = trackNetworkFailures(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );

    const response = await tracker.fetch("https://api.example.com/x");

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
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
