import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { defineRpc } from "@s10n-base/contracts";

import { createRpcClient, DecodeError, NetworkError, RpcError } from "./rpc";
import { fakeFetch, json } from "./test-fetch";

const count = defineRpc({
  method: "example.count",
  auth: "session",
  // NumberFromString: the payload is encoded to a string and the result decoded from one.
  payload: Schema.Struct({ n: Schema.NumberFromString }),
  success: Schema.Struct({ total: Schema.NumberFromString }),
});

describe("createRpcClient", () => {
  it("posts the encoded payload to <baseUrl>/rpc and decodes the result", async () => {
    const { fetch, requests } = fakeFetch(() => json({ ok: true, data: { total: "3" } }));
    const client = createRpcClient({ baseUrl: "https://api.example.com", fetch });

    await expect(client.call(count, { n: 2 })).resolves.toEqual({ total: 3 });

    expect(requests).toEqual([
      {
        url: "https://api.example.com/rpc",
        method: "POST",
        body: { method: "example.count", payload: { n: "2" } },
        credentials: "include",
        signal: undefined,
      },
    ]);
  });

  it("passes the abort signal and the credentials mode through", async () => {
    const { fetch, requests } = fakeFetch(() => json({ ok: true, data: { total: "1" } }));
    const client = createRpcClient({
      baseUrl: "http://localhost:5173",
      fetch,
      credentials: "omit",
    });
    const controller = new AbortController();

    await client.call(count, { n: 1 }, { signal: controller.signal });

    expect(requests[0]?.signal).toBe(controller.signal);
    expect(requests[0]?.credentials).toBe("omit");
  });

  it.each(["", "/", "/api", "localhost:5173", "ftp://example.com", "https://example.com/base"])(
    "refuses a base URL that is not an absolute http(s) origin: %j",
    (baseUrl) => {
      expect(() => createRpcClient({ baseUrl, fetch: fakeFetch(() => json({})).fetch })).toThrow(
        /origin/,
      );
    },
  );

  it("accepts an origin with a trailing slash", async () => {
    const { fetch, requests } = fakeFetch(() => json({ ok: true, data: { total: "1" } }));

    await createRpcClient({ baseUrl: "https://api.example.com/", fetch }).call(count, { n: 1 });

    expect(requests[0]?.url).toBe("https://api.example.com/rpc");
  });

  it("throws an RpcError with the code and status when the server answers with an AppError", async () => {
    const { fetch } = fakeFetch(() =>
      json({ ok: false, error: { code: "auth.unauthenticated", message: "Sign in." } }, 401),
    );
    const client = createRpcClient({ baseUrl: "https://api.example.com", fetch });

    const error = await client.call(count, { n: 1 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: "auth.unauthenticated", status: 401, message: "Sign in." });
  });

  it.each([
    ["a result the contract rejects", json({ ok: true, data: { total: 3 } })],
    ["an envelope with no ok", json({ data: {} })],
    ["an error without a code", json({ ok: false, error: { message: "x" } }, 400)],
    ["a body that is not JSON", new Response("<html>", { status: 200 })],
    ["a 404 HTML page", new Response("Not Found", { status: 404 })],
  ])("throws a DecodeError for %s", async (_label, response) => {
    const { fetch } = fakeFetch(() => response);
    const client = createRpcClient({ baseUrl: "https://api.example.com", fetch });

    await expect(client.call(count, { n: 1 })).rejects.toBeInstanceOf(DecodeError);
  });

  it("throws a NetworkError when no answer arrives: the outcome is unknown", async () => {
    const client = createRpcClient({
      baseUrl: "https://api.example.com",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    const error = await client.call(count, { n: 1 }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  it.each([502, 503, 504])(
    "throws a NetworkError for a proxy's %i that is not the server's envelope",
    async (status) => {
      const { fetch } = fakeFetch(() => new Response("Bad Gateway", { status }));
      const client = createRpcClient({ baseUrl: "https://api.example.com", fetch });

      await expect(client.call(count, { n: 1 })).rejects.toBeInstanceOf(NetworkError);
    },
  );

  it("throws a NetworkError when the body is cut off", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":tr'));
          controller.error(new TypeError("network error"));
        },
      }),
      { status: 200 },
    );
    const client = createRpcClient({
      baseUrl: "https://api.example.com",
      fetch: () => Promise.resolve(broken),
    });

    await expect(client.call(count, { n: 1 })).rejects.toBeInstanceOf(NetworkError);
  });

  it("rethrows an abort as it is, since the caller cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createRpcClient({
      baseUrl: "https://api.example.com",
      fetch: (_input, init) => Promise.reject(init?.signal?.reason as Error),
    });

    const error = await client
      .call(count, { n: 1 }, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as Error).name).toBe("AbortError");
  });

  it("refuses to send a payload the contract cannot encode, without a request", async () => {
    const { fetch, requests } = fakeFetch(() => json({ ok: true, data: { total: "1" } }));
    const client = createRpcClient({ baseUrl: "https://api.example.com", fetch });

    await expect(client.call(count, { n: "x" as unknown as number })).rejects.toThrow(
      'Expected number\n  at ["n"]',
    );
    expect(requests).toEqual([]);
  });
});
