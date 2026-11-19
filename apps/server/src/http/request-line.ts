import type { IncomingMessage } from "node:http";

/**
 * The method and target of a request `http.Server` received. Node types both as optional because
 * `IncomingMessage` also models a client's response, but it always sets them on a server's
 * requests, so there is no fallback to choose.
 */
export function requestLine(request: Pick<IncomingMessage, "method" | "url">): {
  readonly method: string;
  readonly target: string;
} {
  return { method: request.method as string, target: request.url as string };
}
