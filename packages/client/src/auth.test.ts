import { describe, expect, it } from "vitest";

import { lostAnswerFetch, runAuthAction } from "./auth";
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

const URL_X = "https://api.example.com/x";
const answered = () => Promise.resolve(new Response());
const unreachable = () => Promise.reject(new TypeError("Failed to fetch"));
const aborted = () => Promise.reject(new DOMException("aborted", "AbortError"));

// The passkey client catches every error from its last request and reports a cancellation.
const swallowing = async ({ customFetchImpl }: { customFetchImpl: typeof fetch }) => {
  await customFetchImpl(URL_X).catch(() => undefined);
  return { data: null, error: { code: "AUTH_CANCELLED", status: 400 } };
};

const wrapping = async ({ customFetchImpl }: { customFetchImpl: typeof fetch }) => {
  await customFetchImpl(URL_X).catch((cause: unknown) => {
    throw new Error("wrapped", { cause });
  });
  return { data: null, error: null };
};

// The headers arrived, so fetch resolved; then the body stream failed.
const readsBody = async ({ customFetchImpl }: { customFetchImpl: typeof fetch }) => {
  const response = await customFetchImpl("https://api.example.com/reset-password");
  return { data: (await response.json()) as unknown, error: null };
};

describe("runAuthAction", () => {
  it("passes a success through as data", async () => {
    await expect(
      runAuthAction(answered, () => Promise.resolve({ data: { user: 1 }, error: null })),
    ).resolves.toEqual({ ok: true, data: { user: 1 } });
  });

  it("throws a NetworkError when a request failed even if the client turned it into a result", async () => {
    await expect(runAuthAction(unreachable, swallowing)).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws a NetworkError when the client throws after a request failed", async () => {
    await expect(
      runAuthAction(unreachable, ({ customFetchImpl }) =>
        customFetchImpl(URL_X).then(() => ({ data: null, error: null })),
      ),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws a NetworkError when the client wraps a lost answer in an error of its own", async () => {
    await expect(runAuthAction(unreachable, wrapping)).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws a NetworkError when the connection drops while the answer's body is read", async () => {
    await expect(runAuthAction(bodyLostFetch, readsBody)).rejects.toBeInstanceOf(NetworkError);
  });

  it("is not affected by another call's lost answer", async () => {
    const other = runAuthAction(unreachable, ({ customFetchImpl }) =>
      customFetchImpl(URL_X).then(() => ({ data: null, error: null })),
    );
    const own = runAuthAction(answered, async ({ customFetchImpl }) => {
      await other.catch(() => undefined);
      await customFetchImpl(URL_X);
      return { data: "mine", error: null };
    });

    await expect(own).resolves.toEqual({ ok: true, data: "mine" });
  });

  it("rethrows an error that is not a network failure", async () => {
    const failure = new Error("bug");

    await expect(runAuthAction(answered, () => Promise.reject(failure))).rejects.toBe(failure);
  });

  it("does not count an abort as a network failure", async () => {
    await expect(runAuthAction(aborted, swallowing)).resolves.toEqual({
      ok: false,
      code: "AUTH_CANCELLED",
      status: 400,
    });
  });

  it("gives an unknown code when Better Auth sends none", async () => {
    await expect(
      runAuthAction(answered, () => Promise.resolve({ data: null, error: { status: 400 } })),
    ).resolves.toEqual({ ok: false, code: "UNKNOWN", status: 400 });
  });

  it("names a rate limit RATE_LIMITED", async () => {
    await expect(
      runAuthAction(answered, () => Promise.resolve({ data: null, error: { status: 429 } })),
    ).resolves.toEqual({ ok: false, code: "RATE_LIMITED", status: 429 });
  });

  it.each([502, 503, 504])(
    "treats a proxy's %i without a code as a lost answer",
    async (status) => {
      await expect(
        runAuthAction(answered, () => Promise.resolve({ data: null, error: { status } })),
      ).rejects.toBeInstanceOf(NetworkError);
    },
  );
});

describe("lostAnswerFetch", () => {
  it("passes a complete answer through with its status and headers", async () => {
    const fetch = lostAnswerFetch(() =>
      Promise.resolve(
        new Response('{"ok":1}', {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json", "x-test": "kept" },
        }),
      ),
    );

    const response = await fetch(URL_X);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-test")).toBe("kept");
    await expect(response.json()).resolves.toEqual({ ok: 1 });
  });

  it("passes an answer with no body through", async () => {
    const response = await lostAnswerFetch(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    )(URL_X);

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("throws a NetworkError for a lost answer, even with nobody told", async () => {
    await expect(lostAnswerFetch(unreachable)(URL_X)).rejects.toBeInstanceOf(NetworkError);
  });
});
