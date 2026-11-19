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

/** A `fetch` that counts requests that got no answer (an abort is not counted). */
export interface NetworkTracker {
  readonly fetch: typeof fetch;
  readonly failures: () => number;
}

function isAbort(error: unknown): boolean {
  // Not `instanceof Error`: a DOMException is not one in every environment.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function trackNetworkFailures(base: typeof globalThis.fetch): NetworkTracker {
  let failures = 0;
  const tracked = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await base(input, init);
    } catch (error) {
      if (!isAbort(error)) failures += 1;
      throw error;
    }
  };
  return { fetch: tracked as typeof globalThis.fetch, failures: () => failures };
}

/** What a Better Auth client call resolves to. */
export interface AuthClientResult {
  readonly data: unknown;
  readonly error: { readonly code?: string | undefined; readonly status: number } | null;
}

/** Status codes a proxy answers with when the server's answer, if any, was lost. */
const LOST_ANSWER = new Set([502, 503, 504]);

/**
 * Runs one Better Auth client call and turns its result into an {@link AuthResult}.
 *
 * @throws {NetworkError} when any request in the call got no answer, even if the client turned
 * that into an error result (the passkey client reports a lost answer as a cancellation).
 */
export async function runAuthAction(
  tracker: NetworkTracker,
  action: () => Promise<AuthClientResult>,
): Promise<AuthResult> {
  const before = tracker.failures();
  let result: AuthClientResult;
  try {
    result = await action();
  } catch (error) {
    if (tracker.failures() !== before)
      throw new NetworkError("No answer from the server.", { cause: error });
    throw error;
  }
  if (tracker.failures() !== before) throw new NetworkError("No answer from the server.");
  const { error } = result;
  if (error === null) return { ok: true, data: result.data };
  if (error.code === undefined && LOST_ANSWER.has(error.status)) {
    throw new NetworkError(`The server's answer was lost (HTTP ${error.status}).`);
  }
  if (error.status === 429) return { ok: false, code: "RATE_LIMITED", status: 429 };
  return { ok: false, code: error.code ?? "UNKNOWN", status: error.status };
}
