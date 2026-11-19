import fs from "node:fs";
import path from "node:path";

import { Option, Schema } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AppError, BootstrapConfig, RpcRequest } from "@s10n-base/contracts";

import type { ServerConfig } from "../config";
import type { Logger } from "../observability/logger";

interface RouteContext {
  readonly config: ServerConfig;
  readonly logger: Logger;
}

function setCors(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  setCors(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/plain",
) {
  setCors(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", `${contentType}; charset=utf-8`);
  response.end(body);
}

async function readBodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const decodeRpcRequest = Schema.decodeUnknownOption(RpcRequest);

/** Parses and validates the `{method, payload}` envelope; `None` when the body is not one. */
async function readRpcRequest(request: IncomingMessage): Promise<Option.Option<RpcRequest>> {
  const text = await readBodyText(request);
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return Option.none();
  }
  return decodeRpcRequest(body);
}

function sendRpcError(response: ServerResponse, statusCode: number, error: AppError) {
  sendJson(response, statusCode, {
    ok: false,
    error: Schema.encodeSync(AppError)(error),
  });
}

function buildBootstrapConfig(config: ServerConfig, request: IncomingMessage) {
  const hostHeader = request.headers.host ?? `${config.host}:${config.port}`;
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";

  return Schema.encodeSync(BootstrapConfig)({
    appName: config.appName,
    appVersion: config.version,
    apiBaseUrl: `${protocol}://${hostHeader}`,
  });
}

function resolveStaticFile(config: ServerConfig, pathname: string): string | null {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safeRelativePath = path
    .normalize(requestedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^([.][.][\\/])+/, "");
  const absolutePath = path.join(config.paths.webDistDir, safeRelativePath);

  if (!absolutePath.startsWith(config.paths.webDistDir)) {
    return null;
  }
  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    return null;
  }
  return absolutePath;
}

function resolveContentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") {
    setCors(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/config") {
      sendJson(response, 200, buildBootstrapConfig(context.config, request));
      return;
    }

    if (request.method === "POST" && url.pathname === "/rpc") {
      const envelope = await readRpcRequest(request);
      if (Option.isNone(envelope)) {
        sendRpcError(response, 400, {
          code: "rpc.invalid_request",
          message: "The request body is not a valid RPC request.",
        });
        return;
      }

      // The method registry (rpcContracts) is empty, so every method is unknown for now.
      sendRpcError(response, 404, {
        code: "rpc.method_not_found",
        message: `Unknown RPC method ${envelope.value.method}`,
      });
      return;
    }

    const staticFile = resolveStaticFile(context.config, url.pathname);
    if (staticFile) {
      response.statusCode = 200;
      response.setHeader("Content-Type", resolveContentType(staticFile));
      response.end(fs.readFileSync(staticFile));
      return;
    }

    const indexFile = path.join(context.config.paths.webDistDir, "index.html");
    if (fs.existsSync(indexFile)) {
      sendText(response, 200, fs.readFileSync(indexFile, "utf8"), "text/html");
      return;
    }

    sendText(response, 404, "Not Found");
  } catch (error) {
    context.logger.error("request_failed", {
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    sendJson(response, 500, {
      ok: false,
      error: Schema.encodeSync(AppError)({
        code: "server.unexpected_error",
        message: error instanceof Error ? error.message : "Unexpected server error",
      }),
    });
  }
}
