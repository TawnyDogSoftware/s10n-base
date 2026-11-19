/**
 * Converts between Node's `http` messages and the Fetch `Request` and `Response` Better Auth
 * works with.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { requestLine } from "./request-line";

/** Headers that describe one connection, not the request: never passed on. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "content-length",
  "host",
]);

/** A Node request's headers as Fetch `Headers`, keeping repeated values, without hop-by-hop ones. */
export function toFetchHeaders(
  nodeHeaders: IncomingMessage["headers"],
  omit: readonly string[] = [],
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || omit.includes(lower)) continue;
    for (const item of [value ?? []].flat()) headers.append(lower, item);
  }
  return headers;
}

export interface ToFetchRequestOptions {
  /** `APP_URL`: the request's origin as Better Auth sees it, whatever `Host` says. */
  readonly appOrigin: string;
  /** The body already read through the size limit, or `null` for GET and HEAD. */
  readonly body: Buffer | null;
  /** The client's address from the server's resolver, or undefined when unknown. */
  readonly clientIp: string | undefined;
  /** The header Better Auth reads the client's address from. */
  readonly clientIpHeader: string;
}

/**
 * Builds a Fetch `Request` for a Node request. The URL is `appOrigin` with the request's path
 * and query: the `Host` header is never used, and a protocol-relative or absolute request target
 * cannot change the origin. Any incoming copy of the client-IP header is replaced.
 */
export function toFetchRequest(
  request: Pick<IncomingMessage, "method" | "url" | "headers">,
  options: ToFetchRequestOptions,
): Request {
  const line = requestLine(request);
  const target = new URL(line.target, "https://placeholder.invalid");
  const url = new URL(options.appOrigin);
  url.pathname = target.pathname;
  url.search = target.search;

  const headers = toFetchHeaders(request.headers, [options.clientIpHeader]);
  if (options.clientIp !== undefined) headers.set(options.clientIpHeader, options.clientIp);

  return new Request(url, {
    method: line.method,
    headers,
    body: options.body === null ? null : new Uint8Array(options.body),
  });
}

/**
 * Writes a Fetch `Response` to a Node response: the status, every header, each `Set-Cookie` as a
 * header of its own, and the body. Auth responses are never cached.
 */
export async function sendFetchResponse(
  response: ServerResponse,
  fetched: Response,
): Promise<void> {
  const body = Buffer.from(await fetched.arrayBuffer());
  response.statusCode = fetched.status;
  for (const [name, value] of fetched.headers) {
    if (name === "set-cookie" || HOP_BY_HOP.has(name)) continue;
    response.setHeader(name, value);
  }
  const cookies = fetched.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("Set-Cookie", cookies);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", body.length);
  response.end(body);
}
