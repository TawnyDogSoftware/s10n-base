/**
 * The HTTP layer under the RPC and session clients: an explicit base URL, and three kinds of
 * failure that callers must treat differently.
 */
import { Schema } from "effect";

import { AppError } from "@s10n-base/contracts";
import { parseBareOrigin } from "@s10n-base/shared/origin";

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
  /**
   * How long a request may take, headers and body, before it is abandoned as a `NetworkError`
   * (its outcome is unknown). Defaults to {@link DEFAULT_TIMEOUT_MS}.
   */
  readonly timeoutMs?: number;
}

/** The default deadline of one request: long enough for a slow network, short of forever. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Status codes a proxy answers with when the server's answer, if any, was lost. */
const LOST_ANSWER = new Set([502, 503, 504]);

/**
 * The origin of `baseUrl`.
 *
 * @throws {Error} when it is not an absolute http(s) URL with no path, query or fragment.
 */
export function parseBaseUrl(baseUrl: string): string {
  const url = parseBareOrigin(baseUrl);
  if (url === null) {
    throw new Error(`The API base URL must be an absolute http(s) origin; got "${baseUrl}".`);
  }
  return url.origin;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

/**
 * Runs `work` with a signal that aborts when the caller's does or when `ms` pass, and settles as
 * soon as either happens, even if `work` ignores the signal (a body that never ends). Rejects
 * with the abort reason: the caller's, or a {@link DeadlineError}.
 */
async function withDeadline<T>(
  ms: number,
  callerSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    controller.abort(callerSignal?.reason);
  };
  const timer = setTimeout(() => {
    controller.abort(new DeadlineError());
  }, ms);
  if (callerSignal?.aborted === true) abort();
  callerSignal?.addEventListener("abort", abort, { once: true });
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => {
      reject(controller.signal.reason as Error);
    };
    if (controller.signal.aborted) fail();
    controller.signal.addEventListener("abort", fail, { once: true });
  });
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
  }
}

/** The reason a request's own deadline aborts it with. */
class DeadlineError extends Error {
  override readonly name = "DeadlineError";
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The data of a success envelope; any other answer becomes the error it means. A proxy's 502 to
 * 504 is a lost answer whatever its body says, since the server never sends one; and the status
 * and the envelope must agree (a success with 2xx, a refusal without), or the answer is not ours.
 */
function unwrap(status: number, text: string): unknown {
  if (LOST_ANSWER.has(status)) {
    throw new NetworkError(`The server's answer was lost (HTTP ${String(status)}).`);
  }
  const envelope = decodeEnvelope(parseJson(text));
  const success = status >= 200 && status < 300;
  if (envelope._tag === "None" || envelope.value.ok !== success) {
    throw new DecodeError(`Unexpected answer from the server (HTTP ${String(status)}).`);
  }
  if (!envelope.value.ok) {
    throw new RpcError(envelope.value.error.code, envelope.value.error.message, status);
  }
  return envelope.value.data;
}

export function createTransport(options: TransportOptions): Transport {
  const origin = parseBaseUrl(options.baseUrl);
  const credentials = options.credentials ?? "include";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    origin,
    request: async (path, init) => {
      const doFetch = options.fetch ?? globalThis.fetch;
      let answer: { readonly status: number; readonly text: string };
      try {
        answer = await withDeadline(timeoutMs, init.signal, async (signal) => {
          const response = await doFetch(`${origin}${path}`, {
            method: init.method,
            credentials,
            headers:
              init.body === undefined
                ? { accept: "application/json" }
                : { accept: "application/json", "content-type": "application/json" },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
            signal,
          });
          return { status: response.status, text: await response.text() };
        });
      } catch (error) {
        if (error instanceof DeadlineError) {
          throw new NetworkError("No answer from the server in time.", { cause: error });
        }
        if (isAbort(error, init.signal)) throw error;
        throw new NetworkError("No answer from the server.", { cause: error });
      }
      return unwrap(answer.status, answer.text);
    },
  };
}
