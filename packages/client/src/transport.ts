/**
 * The HTTP layer under the RPC and session clients: an explicit base URL, and three kinds of
 * failure that callers must treat differently.
 */
import { Schema } from "effect";

import { AppError } from "@s10n-base/contracts";

/** The server answered with an `AppError`. The request was handled and refused. */
export class RpcError extends Error {
  override readonly name = "RpcError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The server answered with something the contract does not allow: a client and server out of
 * step, or something other than our server answering. The request may have been handled.
 */
export class DecodeError extends Error {
  override readonly name = "DecodeError";
}

/**
 * No answer arrived: the connection failed, dropped, or a proxy gave up. **The outcome is
 * unknown**: the server may have done what was asked. Re-read the state before reporting a
 * failure, and never retry a non-idempotent request blindly.
 */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

export interface TransportOptions {
  /**
   * The API's origin, such as `https://api.example.com`. Always explicit: a relative URL works
   * only in a browser on the same origin, never in a native app.
   */
  readonly baseUrl: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Defaults to `include`, so the session cookie is sent to an API on another origin too. */
  readonly credentials?: RequestCredentials;
}

/** Status codes a proxy answers with when the server's answer, if any, was lost. */
const LOST_ANSWER = new Set([502, 503, 504]);

/**
 * The origin of `baseUrl`.
 *
 * @throws {Error} when it is not an absolute http(s) URL with no path, query or fragment.
 */
export function parseBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`The API base URL must be an absolute http(s) origin; got "${baseUrl}".`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`The API base URL must be an absolute http(s) origin; got "${baseUrl}".`);
  }
  return url.origin;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

const Envelope = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), data: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: AppError }),
]);
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

export interface Transport {
  readonly origin: string;
  /**
   * Sends a request and returns `data` of a `{ok: true, data}` answer.
   *
   * @throws {RpcError} for `{ok: false, error}`.
   * @throws {DecodeError} for an answer that is not the envelope.
   * @throws {NetworkError} when no answer arrived.
   * @throws the abort reason when `signal` aborted.
   */
  readonly request: (
    path: string,
    init: {
      readonly method: "GET" | "POST";
      readonly body?: unknown;
      readonly signal?: AbortSignal;
    },
  ) => Promise<unknown>;
}

export function createTransport(options: TransportOptions): Transport {
  const origin = parseBaseUrl(options.baseUrl);
  const credentials = options.credentials ?? "include";
  return {
    origin,
    request: async (path, init) => {
      const doFetch = options.fetch ?? globalThis.fetch;
      let text: string;
      let status: number;
      try {
        const response = await doFetch(`${origin}${path}`, {
          method: init.method,
          credentials,
          headers:
            init.body === undefined
              ? { accept: "application/json" }
              : { accept: "application/json", "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          ...(init.signal === undefined ? {} : { signal: init.signal }),
        });
        status = response.status;
        text = await response.text();
      } catch (error) {
        if (isAbort(error, init.signal)) throw error;
        throw new NetworkError("No answer from the server.", { cause: error });
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      const envelope = decodeEnvelope(body);
      if (envelope._tag === "None") {
        if (LOST_ANSWER.has(status)) {
          throw new NetworkError(`The server's answer was lost (HTTP ${status}).`);
        }
        throw new DecodeError(`Unexpected answer from the server (HTTP ${status}).`);
      }
      if (!envelope.value.ok) {
        throw new RpcError(envelope.value.error.code, envelope.value.error.message, status);
      }
      return envelope.value.data;
    },
  };
}
