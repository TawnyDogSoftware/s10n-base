import fs from "node:fs";
import path from "node:path";

import { Effect, Schema } from "effect";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  AppError,
  BootstrapConfig,
  NoteCreateRpc,
  NoteDeleteRpc,
  NoteUpdateRpc,
  ProjectCreateRpc,
  ProjectDeleteRpc,
  ProjectGetRpc,
  ProjectsListRpc,
  ProjectUpdateRpc,
  SettingsGetRpc,
  SettingsUpdateRpc,
  type RpcContract,
} from "@s10n-base/contracts";
import { decodeUnknown } from "@s10n-base/shared/json";

import type { ServerConfig } from "../config";
import type { Logger } from "../observability/logger";
import type { ProjectService } from "../services/projectService";
import type { SettingsService } from "../services/settingsService";

interface RequestEnvelope {
  readonly method: string;
  readonly payload: unknown;
}

interface RouteContext {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly projectService: ProjectService;
  readonly settingsService: SettingsService;
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function runRpc<Payload, Success>(
  requestPayload: unknown,
  contract: RpcContract<Payload, Success>,
  handler: (payload: Payload) => Promise<Success> | Success,
) {
  const payload = decodeUnknown(contract.payload, requestPayload);
  const result = await handler(payload);
  return Schema.encodeSync(contract.success as never)(result as never) as Success;
}

function buildBootstrapConfig(config: ServerConfig, request: IncomingMessage) {
  const hostHeader = request.headers.host ?? `${config.host}:${config.port}`;
  const protocol = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const wsProtocol = protocol === "https" ? "wss" : "ws";

  return Schema.encodeSync(BootstrapConfig)({
    appName: config.appName,
    appVersion: config.version,
    apiBaseUrl: `${protocol}://${hostHeader}`,
    websocketUrl: `${wsProtocol}://${hostHeader}/ws`,
    desktopHost: Boolean(process.env.VITE_DEV_SERVER_URL),
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
      const envelope = (await readJsonBody(request)) as RequestEnvelope;
      let result: unknown;

      switch (envelope.method) {
        case ProjectsListRpc.method:
          result = await runRpc(envelope.payload, ProjectsListRpc, async () =>
            context.projectService.listProjects().pipe(Effect.runPromise),
          );
          break;
        case ProjectGetRpc.method:
          result = await runRpc(envelope.payload, ProjectGetRpc, async (payload) =>
            context.projectService.getProject(payload.id).pipe(Effect.runPromise),
          );
          break;
        case ProjectCreateRpc.method:
          result = await runRpc(envelope.payload, ProjectCreateRpc, async (payload) =>
            context.projectService.createProject(payload).pipe(Effect.runPromise),
          );
          break;
        case ProjectUpdateRpc.method:
          result = await runRpc(envelope.payload, ProjectUpdateRpc, async (payload) =>
            context.projectService.updateProject(payload).pipe(Effect.runPromise),
          );
          break;
        case ProjectDeleteRpc.method:
          result = await runRpc(envelope.payload, ProjectDeleteRpc, async (payload) =>
            context.projectService.deleteProject(payload.id).pipe(Effect.runPromise),
          );
          break;
        case NoteCreateRpc.method:
          result = await runRpc(envelope.payload, NoteCreateRpc, async (payload) =>
            context.projectService.createNote(payload).pipe(Effect.runPromise),
          );
          break;
        case NoteUpdateRpc.method:
          result = await runRpc(envelope.payload, NoteUpdateRpc, async (payload) =>
            context.projectService.updateNote(payload).pipe(Effect.runPromise),
          );
          break;
        case NoteDeleteRpc.method:
          result = await runRpc(envelope.payload, NoteDeleteRpc, async (payload) =>
            context.projectService.deleteNote(payload.id).pipe(Effect.runPromise),
          );
          break;
        case SettingsGetRpc.method:
          result = await runRpc(envelope.payload, SettingsGetRpc, () =>
            context.settingsService.get(),
          );
          break;
        case SettingsUpdateRpc.method:
          result = await runRpc(envelope.payload, SettingsUpdateRpc, (payload) =>
            context.settingsService.update(payload),
          );
          break;
        default:
          sendJson(response, 404, {
            ok: false,
            error: Schema.encodeSync(AppError)({
              code: "rpc.method_not_found",
              message: `Unknown RPC method ${envelope.method}`,
            }),
          });
          return;
      }

      sendJson(response, 200, { ok: true, data: result });
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
