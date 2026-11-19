import type { IncomingMessage } from "node:http";

export type BodyRead =
  | { readonly ok: true; readonly body: Buffer }
  | { readonly ok: false; readonly reason: "too_large" | "aborted" };

export type JsonBodyRead =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly status: 400 | 413 | 415;
      readonly message: string;
    }
  | { readonly ok: false; readonly status: "aborted" };

function isClientAbort(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ECONNRESET";
}

/**
 * Reads a request body of at most `limit` bytes. A declared `Content-Length` over the limit is
 * refused before reading, and the running count stops reading once the limit is passed. Either
 * way the rest is left unread, so the caller should answer with `Connection: close`: Node then
 * closes the socket after the response instead of waiting for the rest of the body.
 *
 * @throws {Error} when the stream fails for a reason other than the client going away.
 */
export async function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };

  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of request.iterator({
      destroyOnReturn: false,
    }) as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > limit) return { ok: false, reason: "too_large" };
      chunks.push(chunk);
    }
  } catch (error) {
    if (isClientAbort(error)) return { ok: false, reason: "aborted" };
    throw error;
  }
  return { ok: true, body: Buffer.concat(chunks) };
}

/** Whether the request says its body is JSON: `application/json`, with or without parameters. */
export function isJsonContentType(header: string | undefined): boolean {
  const type = header?.split(";", 1)[0]?.trim().toLowerCase();
  return type === "application/json";
}

/**
 * Reads and parses a JSON body: 415 unless the content type is JSON, 413 over the limit, 400 for
 * text that is not JSON. `aborted` means the client went away and nothing should be sent.
 */
export async function readJsonBody(request: IncomingMessage, limit: number): Promise<JsonBodyRead> {
  if (!isJsonContentType(request.headers["content-type"])) {
    return { ok: false, status: 415, message: "The request body must be application/json." };
  }
  const read = await readBody(request, limit);
  if (!read.ok) {
    return read.reason === "aborted"
      ? { ok: false, status: "aborted" }
      : {
          ok: false,
          status: 413,
          message: `The request body is larger than ${String(limit)} bytes.`,
        };
  }
  try {
    return { ok: true, value: JSON.parse(read.body.toString("utf8")) as unknown };
  } catch {
    return { ok: false, status: 400, message: "The request body is not valid JSON." };
  }
}
