import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { sendFetchResponse, toFetchHeaders, toFetchRequest } from "./fetch-bridge";

const APP_ORIGIN = "https://app.example.com";
const CLIENT_IP_HEADER = "x-test-client-ip";

function incoming(url: string, headers: http.IncomingHttpHeaders, method = "GET") {
  return { method, url, headers } as unknown as http.IncomingMessage;
}

describe("toFetchRequest", () => {
  it("builds the URL from APP_URL and the request's path and query, never from Host", () => {
    const request = toFetchRequest(
      incoming("/api/auth/get-session?x=1", {
        host: "evil.example.com",
        "x-forwarded-host": "evil",
      }),
      {
        appOrigin: APP_ORIGIN,
        body: null,
        clientIp: "203.0.113.5",
        clientIpHeader: CLIENT_IP_HEADER,
      },
    );

    expect(request.url).toBe("https://app.example.com/api/auth/get-session?x=1");
  });

  it("cannot be pointed at another origin by a protocol-relative or absolute target", () => {
    for (const target of ["//evil.example.com/api/auth/x", "http://evil.example.com/api/auth/x"]) {
      const request = toFetchRequest(incoming(target, {}), {
        appOrigin: APP_ORIGIN,
        body: null,
        clientIp: undefined,
        clientIpHeader: CLIENT_IP_HEADER,
      });
      expect(new URL(request.url).origin).toBe(APP_ORIGIN);
    }
  });

  it("copies headers, keeping repeated values, and drops hop-by-hop ones", () => {
    const request = toFetchRequest(
      incoming(
        "/api/auth/x",
        {
          cookie: "a=1; b=2",
          "content-type": "application/json",
          "accept-language": ["en", "fr"] as unknown as string,
          connection: "keep-alive",
          "transfer-encoding": "chunked",
          "content-length": "2",
          host: "app.example.com",
        },
        "POST",
      ),
      {
        appOrigin: APP_ORIGIN,
        body: Buffer.from("{}"),
        clientIp: undefined,
        clientIpHeader: CLIENT_IP_HEADER,
      },
    );

    expect(request.headers.get("cookie")).toBe("a=1; b=2");
    expect(request.headers.get("accept-language")).toBe("en, fr");
    expect(request.headers.get("connection")).toBeNull();
    expect(request.headers.get("transfer-encoding")).toBeNull();
    expect(request.headers.get("host")).toBeNull();
    expect(request.method).toBe("POST");
  });

  it("replaces any incoming client-IP header with the address the server resolved", () => {
    const spoofed = incoming("/api/auth/x", { [CLIENT_IP_HEADER]: "192.0.2.4" });

    const resolved = toFetchRequest(spoofed, {
      appOrigin: APP_ORIGIN,
      body: null,
      clientIp: "203.0.113.5",
      clientIpHeader: CLIENT_IP_HEADER,
    });
    const unknown = toFetchRequest(spoofed, {
      appOrigin: APP_ORIGIN,
      body: null,
      clientIp: undefined,
      clientIpHeader: CLIENT_IP_HEADER,
    });

    expect(resolved.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.5");
    expect(unknown.headers.get(CLIENT_IP_HEADER)).toBeNull();
  });

  it("passes the body it was given", async () => {
    const request = toFetchRequest(
      incoming("/api/auth/x", { "content-type": "application/json" }, "POST"),
      {
        appOrigin: APP_ORIGIN,
        body: Buffer.from('{"a":1}'),
        clientIp: undefined,
        clientIpHeader: CLIENT_IP_HEADER,
      },
    );

    expect(await request.text()).toBe('{"a":1}');
  });
});

describe("sendFetchResponse", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  async function roundTrip(response: Response) {
    server = http.createServer((_request, nodeResponse) => {
      void sendFetchResponse(nodeResponse, response);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return new Promise<http.IncomingMessage & { body: string }>((resolve) => {
      http.get(`http://127.0.0.1:${String(port)}/`, (message) => {
        let body = "";
        message.on("data", (chunk: Buffer) => (body += chunk.toString()));
        message.on("end", () => {
          resolve(Object.assign(message, { body }));
        });
      });
    });
  }

  it("keeps every Set-Cookie header separate", async () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "s10n-base.session_token=abc; Path=/; HttpOnly; SameSite=Lax");
    headers.append(
      "set-cookie",
      "s10n-base.session_data=def; Path=/; HttpOnly; Expires=Thu, 19 Nov 2026 12:00:00 GMT",
    );

    const received = await roundTrip(new Response('{"ok":true}', { status: 200, headers }));

    expect(received.headers["set-cookie"]).toEqual([
      "s10n-base.session_token=abc; Path=/; HttpOnly; SameSite=Lax",
      "s10n-base.session_data=def; Path=/; HttpOnly; Expires=Thu, 19 Nov 2026 12:00:00 GMT",
    ]);
    expect(received.body).toBe('{"ok":true}');
  });

  it("copies the status and headers, and never lets the response be cached", async () => {
    const received = await roundTrip(
      new Response(null, {
        status: 302,
        headers: { location: "https://app.example.com/", "cache-control": "public, max-age=60" },
      }),
    );

    expect(received.statusCode).toBe(302);
    expect(received.headers.location).toBe("https://app.example.com/");
    expect(received.headers["cache-control"]).toBe("no-store");
  });
});

describe("toFetchHeaders", () => {
  it("skips a header Node reports without a value", () => {
    const headers = toFetchHeaders({ "x-empty": undefined, accept: "text/html" }, []);

    expect([...headers.keys()]).toEqual(["accept"]);
  });
});
