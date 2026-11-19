/**
 * The request handler: a thin router over the modules in this directory. Every response carries
 * an `X-Request-Id` and the security headers, every request gets one access-log line, and an
 * unexpected error is logged with its stack and answered with a fixed 500 body.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Schema } from "effect";

import { BootstrapConfig, ERROR_CODES, RpcRequest } from "@s10n-base/contracts";

import type { AppAuth } from "../auth/instance";
import type { ServerConfig } from "../config";
import type { Logger } from "../observability/logger";
import type { RpcDispatcher } from "../rpc/dispatcher";
import {
  handleAuthRequest,
  isAllowedOrigin,
  isAuthPath,
  isCrossSiteGuarded,
  readAppSession,
} from "./auth-routes";
import { readJsonBody } from "./body";
import { resolveClientIp } from "./client-ip";
import { applyCors } from "./cors";
import { requestLine } from "./request-line";
import { HTML_CONTENT_SECURITY_POLICY, applySecurityHeaders } from "./security-headers";
import { isApiPath, resolveStaticFile, sendStaticFile, wantsHtmlFallback } from "./static-files";

export interface HttpContext {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly dispatcher: RpcDispatcher;
  readonly auth: AppAuth;
  /** Whether the database answers; backs `/ready`. */
  readonly checkReadiness: () => Promise<boolean>;
  /** True once shutdown has started: `/ready` answers 503 and connections are not kept alive. */
  readonly isShuttingDown: () => boolean;
}

interface RequestState {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly requestId: string;
  readonly logger: Logger;
  readonly clientIp: string | undefined;
}

type RouteHandler = (state: RequestState, context: HttpContext) => Promise<void>;

/** The fixed body of every 500: nothing about the error reaches the client. */
export const UNEXPECTED_ERROR_BODY = {
  ok: false,
  error: { code: ERROR_CODES.unexpected, message: "Unexpected server error." },
} as const;

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, code: string, message: string) {
  sendJson(response, status, { ok: false, error: { code, message } });
}

const decodeRpcRequest = Schema.decodeUnknownOption(RpcRequest);

const routes: Readonly<Record<string, Readonly<Record<string, RouteHandler>>>> = {
  "/health": {
    // Liveness: answers whenever the process is serving, and touches nothing else.
    GET: ({ response }) => {
      sendJson(response, 200, { ok: true, status: "ok" });
      return Promise.resolve();
    },
  },
  "/ready": {
    GET: async ({ response }, context) => {
      if (context.isShuttingDown()) {
        sendJson(response, 503, { ok: false, status: "shutting_down" });
        return;
      }
      const ready = await context.checkReadiness();
      // Shutdown may have started while the check ran.
      if (context.isShuttingDown()) {
        sendJson(response, 503, { ok: false, status: "shutting_down" });
      } else if (ready) {
        sendJson(response, 200, { ok: true, status: "ready" });
      } else {
        sendJson(response, 503, { ok: false, status: "database_unavailable" });
      }
    },
  },
  "/config": {
    GET: ({ response }, { config }) => {
      sendJson(
        response,
        200,
        Schema.encodeSync(BootstrapConfig)({
          appName: config.appName,
          appVersion: config.version,
          apiBaseUrl: config.appOrigin,
        }),
      );
      return Promise.resolve();
    },
  },
  "/api/app-auth/session": {
    GET: async ({ request, response }, context) => {
      const { body, setCookies } = await readAppSession(request, context.auth);
      if (setCookies.length > 0) response.setHeader("Set-Cookie", [...setCookies]);
      sendJson(response, 200, { ok: true, data: body });
    },
  },
  "/rpc": {
    POST: async ({ request, response, requestId, logger }, context) => {
      const body = await readJsonBody(request, context.config.requestBodyLimitBytes);
      if (!body.ok) {
        if (body.status === "aborted") return;
        // The rest of the body is unread; closing is cheaper than reading it to reuse the socket.
        if (body.status === 413) response.setHeader("Connection", "close");
        sendError(response, body.status, ERROR_CODES.invalidRequest, body.message);
        return;
      }
      const envelope = decodeRpcRequest(body.value);
      if (envelope._tag === "None") {
        sendError(
          response,
          400,
          ERROR_CODES.invalidRequest,
          "The request body is not a valid RPC request.",
        );
        return;
      }
      const result = await context.dispatcher(envelope.value, { requestId, logger, request });
      sendJson(response, result.status, result.body);
    },
  },
};

async function serveWebApp(state: RequestState, context: HttpContext): Promise<boolean> {
  const { request, response, url } = state;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const root = context.config.webDistDir;
  const file =
    (await resolveStaticFile(root, url.pathname)) ??
    (wantsHtmlFallback(request.method, url.pathname, request.headers.accept)
      ? await resolveStaticFile(root, "/index.html")
      : null);
  if (file === null) return false;
  if (file.isHtml) response.setHeader("Content-Security-Policy", HTML_CONTENT_SECURITY_POLICY);
  await sendStaticFile(request.method, response, file);
  return true;
}

/** Answers a CORS preflight; returns false for any other request. */
function answeredPreflight(state: RequestState, context: HttpContext): boolean {
  const cors = applyCors(state.request, state.response, context.config.appOrigin);
  if (cors === "preflight-denied") {
    sendError(state.response, 403, ERROR_CODES.forbidden, "This origin is not allowed.");
    return true;
  }
  if (cors === "preflight-allowed") {
    state.response.statusCode = 204;
    state.response.end();
    return true;
  }
  return false;
}

/** Runs the handler for one of `routes`; returns false when the path is not one of them. */
async function handledRoute(state: RequestState, context: HttpContext): Promise<boolean> {
  const { request, response, url } = state;
  const methods = routes[url.pathname];
  if (methods === undefined) return false;
  const handler = methods[requestLine(request).method];
  if (handler === undefined) {
    response.setHeader("Allow", Object.keys(methods).join(", "));
    sendError(
      response,
      405,
      ERROR_CODES.methodNotAllowed,
      `${String(request.method)} is not allowed here.`,
    );
    return true;
  }
  await handler(state, context);
  return true;
}

async function route(state: RequestState, context: HttpContext): Promise<void> {
  const { request, response, url } = state;
  if (answeredPreflight(state, context)) return;

  if (isCrossSiteGuarded(url.pathname) && !(await isAllowedOrigin(request, context.auth))) {
    request.resume();
    sendError(response, 403, ERROR_CODES.forbidden, "This origin is not allowed.");
    return;
  }
  if (isAuthPath(url.pathname)) {
    await handleAuthRequest(state, {
      auth: context.auth,
      appOrigin: context.config.appOrigin,
      bodyLimitBytes: context.config.requestBodyLimitBytes,
      sendError,
    });
    return;
  }

  if (await handledRoute(state, context)) return;
  if (isApiPath(url.pathname)) {
    sendError(response, 404, ERROR_CODES.notFound, "Not found.");
    return;
  }
  if (await serveWebApp(state, context)) return;
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Not Found");
}

function parseUrl(request: IncomingMessage): URL | undefined {
  try {
    return new URL(requestLine(request).target, "http://localhost");
  } catch {
    return undefined;
  }
}

/** Builds the `node:http` request listener. */
export function createRequestHandler(context: HttpContext) {
  const https = context.config.appOrigin.startsWith("https://");

  return (request: IncomingMessage, response: ServerResponse): void => {
    const startedAt = performance.now();
    // Always our own id: an incoming X-Request-Id is not trusted.
    const requestId = randomUUID();
    const clientIp = resolveClientIp(request, context.config.trustedProxyHops);
    const logger = context.logger.child({ requestId });
    const url = parseUrl(request);

    response.setHeader("X-Request-Id", requestId);
    applySecurityHeaders(response, { https });
    if (context.isShuttingDown()) response.setHeader("Connection", "close");

    let logged = false;
    const logAccess = () => {
      if (logged) return;
      logged = true;
      logger.info("request", {
        method: request.method,
        path: url?.pathname ?? "(invalid)",
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        clientIp,
        ...(response.writableFinished ? {} : { aborted: true }),
      });
    };
    response.once("finish", logAccess);
    response.once("close", logAccess);

    if (url === undefined) {
      sendError(response, 400, ERROR_CODES.invalidRequest, "The request URL is not valid.");
      return;
    }

    route({ request, response, url, requestId, logger, clientIp }, context).catch(
      (error: unknown) => {
        logger.error("request_failed", { method: request.method, path: url.pathname, error });
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendJson(response, 500, UNEXPECTED_ERROR_BODY);
      },
    );
  };
}
