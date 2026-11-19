import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

import { Redacted, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defineRpc, ERROR_CODES } from "@s10n-base/contracts";

import type { ServerConfig } from "../config";
import type { AppAuth } from "../auth/instance";
import { CLIENT_IP_HEADER } from "../auth/options";
import { createLogger } from "../observability/logger";
import { testServerConfig } from "../test/config";
import {
  anonymousActorResolver,
  createRpcDispatcher,
  defineHandler,
  type RpcDispatcher,
  type RpcHandlerContext,
} from "../rpc/dispatcher";
import { HTML_CONTENT_SECURITY_POLICY } from "./security-headers";
import { UNEXPECTED_ERROR_BODY, createRequestHandler, type HttpContext } from "./routes";

const APP_ORIGIN = "http://localhost:5173";

/** An AppAuth that admits nothing and knows no session unless a test says otherwise. */
function fakeAuth(overrides: Partial<AppAuth> = {}): AppAuth {
  return {
    handler: () => Promise.resolve(new Response("{}", { status: 200 })),
    guard: () => Promise.resolve(false),
    routes: [],
    getSession: () => Promise.resolve(null),
    readSession: () => Promise.resolve({ session: null, setCookies: [] }),
    isTrustedOrigin: (origin) =>
      Promise.resolve(origin === APP_ORIGIN || origin.startsWith("s10nbase-dev://")),
    updateUserName: () => Promise.reject(new Error("not used in these tests")),
    ...overrides,
  };
}
let parent: string;
let webDistDir: string;
let server: http.Server | undefined;
let logLines: Array<Record<string, unknown>>;

beforeAll(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "s10n-routes-"));
  webDistDir = path.join(parent, "dist");
  fs.mkdirSync(path.join(webDistDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(webDistDir, "index.html"), "<!doctype html><title>app</title>");
  fs.writeFileSync(path.join(webDistDir, "assets", "app-1a2b3c.js"), "export {};");
  fs.mkdirSync(path.join(parent, "dist-evil"));
  fs.writeFileSync(path.join(parent, "dist-evil", "secret.txt"), "secret");
});

afterAll(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

const empty = Schema.Struct({});
const echo = defineRpc({
  method: "fixture.echo",
  auth: "public",
  payload: Schema.Struct({ text: Schema.String }),
  success: Schema.Struct({ text: Schema.String }),
});
const secret = defineRpc({
  method: "fixture.secret",
  auth: "session",
  payload: empty,
  success: empty,
});
const boom = defineRpc({ method: "fixture.boom", auth: "public", payload: empty, success: empty });

const defaultDispatcher = createRpcDispatcher({
  handlers: [
    defineHandler(echo, (payload) => Promise.resolve(payload)),
    defineHandler(secret, () => Promise.resolve({})),
    defineHandler(boom, () => Promise.reject(new Error("db password is hunter2"))),
  ],
  resolveActor: anonymousActorResolver,
});

interface StartOptions {
  readonly auth?: Partial<AppAuth>;
  readonly appOrigin?: string;
  readonly webDistDir?: string;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly isShuttingDown?: () => boolean;
  readonly dispatcher?: RpcDispatcher;
  readonly trustedProxyHops?: number;
}

async function start(options: StartOptions = {}) {
  logLines = [];
  const config: ServerConfig = testServerConfig({
    version: "1.2.3",
    appOrigin: options.appOrigin ?? APP_ORIGIN,
    databaseUrl: Redacted.make("postgres://u:p@localhost/db"),
    trustedProxyHops: options.trustedProxyHops ?? 0,
    shutdownTimeoutMs: 1000,
    webDistDir: options.webDistDir ?? webDistDir,
  });
  const context: HttpContext = {
    config,
    logger: createLogger({
      level: "debug",
      write: (line) => logLines.push(JSON.parse(line) as Record<string, unknown>),
    }),
    dispatcher: options.dispatcher ?? defaultDispatcher,
    auth: fakeAuth(options.auth),
    checkReadiness: options.checkReadiness ?? (() => Promise.resolve(true)),
    isShuttingDown: options.isShuttingDown ?? (() => false),
  };
  server = http.createServer(createRequestHandler(context));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

function rpc(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Sends a raw request line, for paths fetch would normalise first. */
async function rawGet(base: string, target: string) {
  const { port } = new URL(base);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: target, method: "GET" },
      (response) => {
        let body = "";
        response.setEncoding("utf8").on("data", (chunk: string) => (body += chunk));
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("every response", () => {
  it("carries a fresh request id, ignoring the client's", async () => {
    const base = await start();

    const first = await fetch(`${base}/health`, { headers: { "x-request-id": "client-chosen" } });
    const second = await fetch(`${base}/health`);

    const id = first.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe("client-chosen");
    expect(second.headers.get("x-request-id")).not.toBe(id);
  });

  it("carries the security headers, without HSTS on http", async () => {
    const base = await start();

    const response = await fetch(`${base}/health`);

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("carries HSTS when APP_URL is https", async () => {
    const base = await start({ appOrigin: "https://app.example.com" });

    const response = await fetch(`${base}/health`);

    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("is logged once, with the path but not the query string", async () => {
    const base = await start();

    const response = await fetch(`${base}/health?token=abc`, {
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    await response.text();

    await vi.waitFor(() => {
      expect(logLines.filter((line) => line.message === "request")).toHaveLength(1);
    });
    const line = logLines.find((entry) => entry.message === "request");
    expect(line).toMatchObject({
      level: "info",
      method: "GET",
      path: "/health",
      status: 200,
      requestId: response.headers.get("x-request-id"),
      clientIp: "127.0.0.1",
    });
    expect(line?.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(logLines)).not.toContain("token=abc");
  });

  it("logs the forwarded client address behind a trusted proxy", async () => {
    const base = await start({ trustedProxyHops: 1 });

    await (
      await fetch(`${base}/health`, { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.7" } })
    ).text();

    await vi.waitFor(() => {
      expect(logLines.find((line) => line.message === "request")).toMatchObject({
        clientIp: "198.51.100.7",
      });
    });
  });

  it("asks the client to close the connection once shutdown has started", async () => {
    const base = await start({ isShuttingDown: () => true });

    const response = await fetch(`${base}/health`);

    expect(response.headers.get("connection")).toBe("close");
  });
});

describe("CORS", () => {
  it("allows the app's origin with credentials", async () => {
    const base = await start();

    const response = await fetch(`${base}/config`, { headers: { origin: APP_ORIGIN } });

    expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("sends no CORS headers to another origin", async () => {
    const base = await start();

    const response = await fetch(`${base}/config`, {
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers the app's preflight with 204 and refuses another origin's with 403", async () => {
    const base = await start();
    const preflight = (origin: string) =>
      fetch(`${base}/rpc`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

    const allowed = await preflight(APP_ORIGIN);
    const denied = await preflight("https://evil.example.com");

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("GET, POST");
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("health, readiness and config", () => {
  it("answers /health without checking the database", async () => {
    const checkReadiness = vi.fn<HttpContext["checkReadiness"]>(() => Promise.resolve(false));
    const base = await start({ checkReadiness });

    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "ok" });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it("answers /ready 200 when the database answers and 503 when it does not", async () => {
    let ready = true;
    const base = await start({ checkReadiness: () => Promise.resolve(ready) });

    const up = await fetch(`${base}/ready`);
    ready = false;
    const down = await fetch(`${base}/ready`);

    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ ok: true, status: "ready" });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, status: "database_unavailable" });
  });

  it("answers /ready 503 while shutting down, without checking the database", async () => {
    const checkReadiness = vi.fn<HttpContext["checkReadiness"]>(() => Promise.resolve(true));
    const base = await start({ checkReadiness, isShuttingDown: () => true });

    const response = await fetch(`${base}/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, status: "shutting_down" });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it("serves /config with apiBaseUrl from APP_URL, whatever the Host and proxy headers say", async () => {
    const base = await start({ appOrigin: "https://app.example.com" });

    const response = await fetch(`${base}/config`, {
      headers: { "x-forwarded-proto": "http", "x-forwarded-host": "evil.example.com" },
    });

    expect(await response.json()).toEqual({
      appName: "S10N Base",
      appVersion: "1.2.3",
      apiBaseUrl: "https://app.example.com",
    });
  });
});

describe("routing", () => {
  it.each(["/rpc/extra", "/api/anything", "/health/x", "/config/x"])(
    "answers 404 JSON for the unknown API path %s",
    async (pathname) => {
      const base = await start();

      const response = await fetch(`${base}${pathname}`, { headers: { accept: "text/html" } });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        ok: false,
        error: { code: ERROR_CODES.notFound, message: "Not found." },
      });
    },
  );

  it.each([
    ["GET", "/rpc", "POST"],
    ["POST", "/health", "GET"],
    ["DELETE", "/config", "GET"],
  ])("answers 405 for %s %s with Allow: %s", async (method, pathname, allow) => {
    const base = await start();

    const response = await fetch(`${base}${pathname}`, { method });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.methodNotAllowed,
    );
  });
});

describe("POST /rpc", () => {
  it("dispatches a valid call", async () => {
    const base = await start();

    const response = await rpc(base, { method: "fixture.echo", payload: { text: "hi" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { text: "hi" } });
  });

  it("answers 401 for a session method called anonymously", async () => {
    const base = await start();

    const response = await rpc(base, { method: "fixture.secret", payload: {} });

    expect(response.status).toBe(401);
  });

  it.each([
    ["not JSON", "{not json", 400],
    ["not an envelope", { method: 42, payload: {} }, 400],
    ["empty", "", 400],
  ])("answers 400 rpc.invalid_request for a body that is %s", async (_case, body, status) => {
    const base = await start();

    const response = await rpc(base, body);

    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.invalidRequest,
    );
  });

  it("answers 415 for a body that is not application/json", async () => {
    const base = await start();

    const response = await rpc(base, "{}", { "content-type": "text/plain" });

    expect(response.status).toBe(415);
  });

  it("answers 413 for a body over REQUEST_BODY_LIMIT_BYTES", async () => {
    const base = await start();

    const response = await rpc(base, {
      method: "fixture.echo",
      payload: { text: "x".repeat(2048) },
    });

    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
  });

  it("answers a thrown error with the fixed 500 body and logs it with the request id and stack", async () => {
    const base = await start();

    const response = await rpc(base, { method: "fixture.boom", payload: {} });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: ERROR_CODES.unexpected, message: "Unexpected server error." },
    });
    expect(text).not.toContain("hunter2");
    const failure = logLines.find((line) => line.message === "request_failed");
    expect(failure).toMatchObject({
      level: "error",
      requestId: response.headers.get("x-request-id"),
      error: { name: "Error", message: "db password is hunter2" },
    });
    const logged = failure?.error as { stack?: string } | undefined;
    expect(logged?.stack).toContain("db password is hunter2");
  });
});

describe("the web app", () => {
  it("serves index.html at / with the CSP and no-cache", async () => {
    const base = await start();

    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>app</title>");
    expect(response.headers.get("content-security-policy")).toBe(HTML_CONTENT_SECURITY_POLICY);
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves hashed assets as immutable, without a CSP", async () => {
    const base = await start();

    const response = await fetch(`${base}/assets/app-1a2b3c.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("answers HEAD with the headers only", async () => {
    const base = await start();

    const response = await fetch(`${base}/assets/app-1a2b3c.js`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it("falls back to index.html for a page navigation", async () => {
    const base = await start();

    const response = await fetch(`${base}/settings/profile`, { headers: { accept: "text/html" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>app</title>");
  });

  it("answers 404 for a missing file that is not a page navigation", async () => {
    const base = await start();

    expect((await fetch(`${base}/missing.js`, { headers: { accept: "*/*" } })).status).toBe(404);
    expect(
      (await fetch(`${base}/settings`, { method: "POST", headers: { accept: "text/html" } }))
        .status,
    ).toBe(404);
  });

  it.each([
    "/../dist-evil/secret.txt",
    "/..%2fdist-evil%2fsecret.txt",
    "/%2e%2e%2fdist-evil%2fsecret.txt",
  ])("never serves the sibling directory through %s", async (target) => {
    const base = await start();

    const response = await rawGet(base, target);

    expect(response.body).not.toContain("secret");
  });

  it("answers a file it cannot read with the fixed 500 body", async () => {
    const unreadable = path.join(webDistDir, "assets", "locked-9z8y7x.js");
    fs.writeFileSync(unreadable, "export {};");
    fs.chmodSync(unreadable, 0o000);
    try {
      const base = await start();

      const response = await fetch(`${base}/assets/locked-9z8y7x.js`);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(UNEXPECTED_ERROR_BODY);
      expect(logLines.find((line) => line.message === "request_failed")).toMatchObject({
        error: { code: "EACCES" },
      });
    } finally {
      fs.rmSync(unreadable, { force: true });
    }
  });

  it("answers 404 for every non-API path when there is no web build", async () => {
    const base = await start({ webDistDir: path.join(parent, "no-build") });

    expect((await fetch(`${base}/`, { headers: { accept: "text/html" } })).status).toBe(404);
    expect((await fetch(`${base}/settings`, { headers: { accept: "text/html" } })).status).toBe(
      404,
    );
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

describe("cross-site requests", () => {
  it("refuses /rpc from an origin that is not trusted, before any work is done", async () => {
    const handle = vi.fn<
      (payload: unknown, context: RpcHandlerContext) => Promise<{ text: string }>
    >(() => Promise.resolve({ text: "hi" }));
    const dispatcher = createRpcDispatcher({
      handlers: [defineHandler(echo, handle)],
      resolveActor: anonymousActorResolver,
    });
    const base = await start({ dispatcher });

    const response = await rpc(
      base,
      { method: "fixture.echo", payload: { text: "hi" } },
      { origin: "https://evil.example.com" },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: ERROR_CODES.forbidden, message: "This origin is not allowed." },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses an opaque null origin", async () => {
    const base = await start();

    const response = await rpc(
      base,
      { method: "fixture.echo", payload: { text: "hi" } },
      {
        origin: "null",
      },
    );

    expect(response.status).toBe(403);
  });

  it("lets /rpc through from APP_URL, from a trusted app scheme, and with no Origin at all", async () => {
    const base = await start();
    const call = (headers: Record<string, string>) =>
      rpc(base, { method: "fixture.echo", payload: { text: "hi" } }, headers);

    expect((await call({ origin: APP_ORIGIN })).status).toBe(200);
    expect((await call({ origin: "s10nbase-dev://" })).status).toBe(200);
    expect((await call({})).status).toBe(200);
  });

  it("refuses /api/app-auth/* from an origin that is not trusted", async () => {
    const readSession = vi.fn<AppAuth["readSession"]>(() =>
      Promise.resolve({ session: null, setCookies: [] }),
    );
    const base = await start({ auth: { readSession } });

    const response = await fetch(`${base}/api/app-auth/session`, {
      headers: { origin: "https://evil.example.com" },
    });

    expect(response.status).toBe(403);
    expect(readSession).not.toHaveBeenCalled();
  });
});

describe("GET /api/app-auth/session", () => {
  const session = {
    userId: "u1",
    email: "user@example.com",
    name: "User",
    image: null,
    role: "user" as const,
    emailVerified: true,
  };

  it("answers the session as an AppSession, uncached, reading the request's cookie", async () => {
    const readSession = vi.fn<AppAuth["readSession"]>(() =>
      Promise.resolve({ session, setCookies: [] }),
    );
    const base = await start({ auth: { readSession } });

    const response = await fetch(`${base}/api/app-auth/session`, {
      headers: { cookie: "s10n-base.session_token=abc" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ ok: true, data: { session } });
    expect(readSession.mock.calls[0]?.[0].get("cookie")).toBe("s10n-base.session_token=abc");
  });

  it("passes on the cookies Better Auth sets while reading the session, such as a renewal", async () => {
    const readSession = vi.fn<AppAuth["readSession"]>(() =>
      Promise.resolve({
        session,
        setCookies: [
          "s10n-base.session_token=renewed; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
          "s10n-base.session_data=; Max-Age=0; Path=/",
        ],
      }),
    );
    const base = await start({ auth: { readSession } });

    const response = await fetch(`${base}/api/app-auth/session`, {
      headers: { cookie: "s10n-base.session_token=abc" },
    });

    expect(await response.json()).toEqual({ ok: true, data: { session } });
    expect(response.headers.getSetCookie()).toEqual([
      "s10n-base.session_token=renewed; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
      "s10n-base.session_data=; Max-Age=0; Path=/",
    ]);
  });

  it("answers null when signed out", async () => {
    const base = await start();

    const response = await fetch(`${base}/api/app-auth/session`);

    expect(await response.json()).toEqual({ ok: true, data: { session: null } });
  });

  it("answers 405 to another method", async () => {
    const base = await start();

    expect((await fetch(`${base}/api/app-auth/session`, { method: "POST" })).status).toBe(405);
  });
});

describe("/api/auth", () => {
  it("answers 404 JSON for a route the guard refuses, without reading the body or calling Better Auth", async () => {
    const handler = vi.fn<AppAuth["handler"]>(() => Promise.resolve(new Response("{}")));
    const guard = vi.fn<AppAuth["guard"]>(() => Promise.resolve(false));
    const base = await start({ auth: { handler, guard } });

    const response = await fetch(`${base}/api/auth/not-a-route?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: ERROR_CODES.notFound, message: "Not found." },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith("POST", new URL(`${APP_ORIGIN}/api/auth/not-a-route?x=1`));
  });

  it("passes an admitted request to Better Auth under APP_URL, with the body and the resolved client IP", async () => {
    const handler = vi.fn<AppAuth["handler"]>(() => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return Promise.resolve(new Response('{"token":"t"}', { status: 200, headers }));
    });
    const base = await start({ auth: { handler, guard: () => Promise.resolve(true) } });

    const response = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "evil.example.com",
        [CLIENT_IP_HEADER]: "6.6.6.6",
      },
      body: '{"email":"a@example.com"}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe('{"token":"t"}');
    const request = handler.mock.calls[0]?.[0];
    expect(request?.url).toBe(`${APP_ORIGIN}/api/auth/sign-in/email`);
    expect(await request?.text()).toBe('{"email":"a@example.com"}');
    expect(request?.headers.get(CLIENT_IP_HEADER)).toBe("127.0.0.1");
  });

  it("refuses a body over the limit with 413, without calling Better Auth", async () => {
    const handler = vi.fn<AppAuth["handler"]>(() => Promise.resolve(new Response("{}")));
    const base = await start({ auth: { handler, guard: () => Promise.resolve(true) } });

    const response = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(4096) }),
    });

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("sends a GET without a body", async () => {
    const handler = vi.fn<AppAuth["handler"]>(() => Promise.resolve(new Response("null")));
    const base = await start({ auth: { handler, guard: () => Promise.resolve(true) } });

    await fetch(`${base}/api/auth/get-session`);

    expect(handler.mock.calls[0]?.[0].body).toBeNull();
  });
});
