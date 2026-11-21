/**
 * The auth routes: Better Auth at `/api/auth/*` behind the route guard, and the app's own
 * session route at `/api/app-auth/session`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { Schema } from "effect";

import { AppSessionResponse, ERROR_CODES } from "@s10n-base/contracts";

import type { AppAuth } from "../auth/instance";
import { AUTH_BASE_PATH, CLIENT_IP_HEADER } from "../auth/options";
import { readBody } from "./body";
import { sendFetchResponse, toFetchHeaders, toFetchRequest } from "./fetch-bridge";
import { requestLine } from "./request-line";

const APP_AUTH_BASE_PATH = "/api/app-auth";

const BODYLESS = new Set(["GET", "HEAD"]);
const encodeSessionResponse = Schema.encodeSync(AppSessionResponse);

/** Whether a path belongs to Better Auth: `/api/auth` and everything under it. */
export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`);
}

/** Paths that refuse a request carrying an `Origin` Better Auth does not trust. */
export function isCrossSiteGuarded(pathname: string): boolean {
  return (
    pathname === "/rpc" ||
    pathname === APP_AUTH_BASE_PATH ||
    pathname.startsWith(`${APP_AUTH_BASE_PATH}/`)
  );
}

/**
 * Whether a request may go on: true without an `Origin` header (mobile apps and servers send
 * none, and still need a session), or with one Better Auth trusts.
 */
export async function isAllowedOrigin(request: IncomingMessage, auth: AppAuth): Promise<boolean> {
  const origin = request.headers.origin;
  return origin === undefined || (await auth.isTrustedOrigin(origin));
}

type SendError = (response: ServerResponse, status: number, code: string, message: string) => void;

export interface AuthRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly clientIp: string | undefined;
}

export interface AuthRouteContext {
  readonly auth: AppAuth;
  readonly appOrigin: string;
  readonly bodyLimitBytes: number;
  readonly sendError: SendError;
}

/**
 * Passes a request to Better Auth, if the guard admits it: the guard first (404 otherwise, with
 * the body unread), then the body through the size limit (413), then Better Auth with the URL
 * under `APP_URL` and the client's address in the internal header.
 */
export async function handleAuthRequest(
  { request, response, url, clientIp }: AuthRequest,
  context: AuthRouteContext,
): Promise<void> {
  const { method } = requestLine(request);
  const target = new URL(`${url.pathname}${url.search}`, context.appOrigin);
  if (!(await context.auth.guard(method, target))) {
    response.setHeader("Connection", "close");
    context.sendError(response, 404, ERROR_CODES.notFound, "Not found.");
    return;
  }
  let body: Buffer | null = null;
  if (!BODYLESS.has(method)) {
    const read = await readBody(request, context.bodyLimitBytes);
    if (!read.ok) {
      if (read.reason === "aborted") return;
      response.setHeader("Connection", "close");
      context.sendError(
        response,
        413,
        ERROR_CODES.invalidRequest,
        `The request body is larger than ${String(context.bodyLimitBytes)} bytes.`,
      );
      return;
    }
    body = read.body;
  }
  const fetched = await context.auth.handler(
    toFetchRequest(request, {
      appOrigin: context.appOrigin,
      body,
      clientIp,
      clientIpHeader: CLIENT_IP_HEADER,
    }),
  );
  await sendFetchResponse(response, fetched);
}

/**
 * `GET /api/app-auth/session`: the signed-in user's `AppSession`, or `null`, and the cookies
 * Better Auth set while reading it, which the route must send on (a renewed session cookie).
 */
export async function readAppSession(request: IncomingMessage, auth: AppAuth) {
  const { session, setCookies } = await auth.readSession(toFetchHeaders(request.headers));
  return { body: encodeSessionResponse({ session }), setCookies };
}
