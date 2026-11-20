/**
 * What the web and mobile auth adapters share: results as plain data (`{ok: true, data}` or
 * `{ok: false, code, status}`), and a thrown `NetworkError` when no answer arrived, because then
 * the outcome is unknown (see `./query-state`, rule 5). Each app wraps its own Better Auth client
 * (the browser client on the web, the Expo client on mobile) with {@link runAuthAction}.
 */
import { NetworkError } from "./transport";

export type AuthFailure = { readonly ok: false; readonly code: string; readonly status: number };
export type AuthResult<T = unknown> = { readonly ok: true; readonly data: T } | AuthFailure;

/** The password and email actions every app offers. */
export interface PasswordAuth {
  readonly signUp: (input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthResult>;
  readonly signIn: (input: {
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthResult>;
  readonly signOut: () => Promise<AuthResult>;
  readonly sendVerificationEmail: (email: string) => Promise<AuthResult>;
  readonly requestPasswordReset: (email: string) => Promise<AuthResult>;
}

function isAbort(error: unknown): boolean {
  // Not `instanceof Error`: a DOMException is not one in every environment.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Statuses whose responses cannot carry a body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * A `fetch` that reads each answer whole and throws a `NetworkError` for a request that got no
 * complete answer: the connection failed before the headers, or dropped while the body was read.
 * `onLost` is told of each one. An abort is passed through as it is.
 */
export function lostAnswerFetch(base: typeof fetch, onLost: () => void = () => undefined) {
  const counted = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      if (isAbort(error)) throw error;
      onLost();
      throw new NetworkError("No answer from the server.", { cause: error });
    }
  };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await counted(() => base(input, init));
    // The body is read here: a connection that drops after the headers is as much a lost answer
    // as one that drops before them. Auth answers are small JSON.
    const body = await counted(() => response.arrayBuffer());
    return new Response(NULL_BODY.has(response.status) ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/** The per-call options a Better Auth client method takes: this call's own `fetch`. */
export interface CallFetchOptions {
  readonly customFetchImpl: typeof fetch;
}

/** What a Better Auth client call resolves to. */
export interface AuthClientResult {
  readonly data: unknown;
  readonly error: { readonly code?: string | undefined; readonly status: number } | null;
}

/** Status codes a proxy answers with when the server's answer, if any, was lost. */
const LOST_ANSWER = new Set([502, 503, 504]);

/**
 * Runs one Better Auth client call and turns its result into an {@link AuthResult}. The call
 * gets its own `fetch` to pass in its `fetchOptions`, so only its own requests decide whether its
 * answer was lost, never another call running at the same time.
 *
 * @throws {NetworkError} when any request in the call got no answer, even if the client turned
 * that into an error result (the passkey client reports a lost answer as a cancellation).
 */
export async function runAuthAction(
  base: typeof fetch,
  action: (fetchOptions: CallFetchOptions) => Promise<AuthClientResult>,
): Promise<AuthResult> {
  // An object, not a variable: the requests set it from inside the action.
  const call = { lost: false };
  const customFetchImpl = lostAnswerFetch(base, () => {
    call.lost = true;
  });
  let result: AuthClientResult;
  try {
    result = await action({ customFetchImpl });
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    if (call.lost) throw new NetworkError("No answer from the server.", { cause: error });
    throw error;
  }
  if (call.lost) throw new NetworkError("No answer from the server.");
  const { error } = result;
  if (error === null) return { ok: true, data: result.data };
  if (error.code === undefined && LOST_ANSWER.has(error.status)) {
    throw new NetworkError(`The server's answer was lost (HTTP ${String(error.status)}).`);
  }
  if (error.status === 429) return { ok: false, code: "RATE_LIMITED", status: 429 };
  return { ok: false, code: error.code ?? "UNKNOWN", status: error.status };
}
