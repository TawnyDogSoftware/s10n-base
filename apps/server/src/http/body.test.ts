import http from "node:http";
import net from "node:net";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { readBody as readRawBody, readJsonBody } from "./body";

/** readBody with the body as text, so the test server can send it back as JSON. */
async function readBody(request: http.IncomingMessage, limit: number) {
  const result = await readRawBody(request, limit);
  return result.ok ? { ok: true, body: result.body.toString("utf8") } : result;
}

const LIMIT = 1024;
let server: http.Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

/** A server that answers with what the reader returned, closing the connection on failure. */
async function start(read: (request: http.IncomingMessage) => Promise<unknown>) {
  server = http.createServer((request, response) => {
    void read(request).then((result) => {
      const failed =
        typeof result === "object" && result !== null && "ok" in result && result.ok === false;
      if (failed) response.setHeader("Connection", "close");
      response.statusCode = failed && "status" in result ? Number(result.status) : 200;
      response.end(JSON.stringify(result));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as net.AddressInfo;
  return { url: `http://127.0.0.1:${String(address.port)}/`, port: address.port };
}

function post(url: string, body: string, contentType = "application/json") {
  return fetch(url, { method: "POST", headers: { "content-type": contentType }, body });
}

describe("readBody", () => {
  it("reads a body within the limit", async () => {
    const { url } = await start((request) => readBody(request, LIMIT));

    const response = await post(url, "x".repeat(LIMIT));

    expect(await response.json()).toEqual({ ok: true, body: "x".repeat(LIMIT) });
  });

  it("stops at the limit while reading", async () => {
    const { url } = await start((request) => readBody(request, LIMIT));

    const response = await fetch(url, {
      method: "POST",
      // A stream has no Content-Length, so only the running count can catch it.
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(LIMIT + 1)));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    expect(await response.json()).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a declared Content-Length over the limit, answers, and closes the socket", async () => {
    const { port } = await start((request) => readBody(request, LIMIT));
    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    let received = "";
    socket.setEncoding("utf8").on("data", (chunk: string) => (received += chunk));

    // Claims 10 MB and sends a little: the server must answer and close without waiting.
    socket.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10485760\r\n\r\nabc");
    await once(socket, "close");

    expect(received).toMatch(/^HTTP\/1\.1 200 OK/);
    expect(received).toContain('{"ok":false,"reason":"too_large"}');
  });
});

describe("readJsonBody", () => {
  it("parses JSON", async () => {
    const { url } = await start((request) => readJsonBody(request, LIMIT));

    expect(await (await post(url, '{"a":[1,2]}')).json()).toEqual({
      ok: true,
      value: { a: [1, 2] },
    });
  });

  it("accepts a charset parameter and any letter case", async () => {
    const { url } = await start((request) => readJsonBody(request, LIMIT));

    const response = await post(url, "{}", "Application/JSON; charset=utf-8");

    expect(await response.json()).toEqual({ ok: true, value: {} });
  });

  it.each(["text/plain", "application/jsonx", "multipart/form-data"])(
    "answers 415 for %s",
    async (type) => {
      const { url } = await start((request) => readJsonBody(request, LIMIT));

      const response = await post(url, "{}", type);

      expect(response.status).toBe(415);
    },
  );

  it("answers 415 with no content type", async () => {
    const { url } = await start((request) => readJsonBody(request, LIMIT));

    const response = await fetch(url, { method: "POST", body: new Uint8Array([123, 125]) });

    expect(response.status).toBe(415);
  });

  it("answers 400 for invalid JSON", async () => {
    const { url } = await start((request) => readJsonBody(request, LIMIT));

    const response = await post(url, "{not json");

    expect(response.status).toBe(400);
  });

  it("answers 413 for a body over the limit", async () => {
    const { url } = await start((request) => readJsonBody(request, LIMIT));

    const response = await post(url, JSON.stringify({ text: "x".repeat(LIMIT * 4) }));

    expect(response.status).toBe(413);
  });
});
