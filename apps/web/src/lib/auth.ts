/**
 * The web app's Better Auth client, behind a small interface whose results are plain data:
 * `{ok: true, data}`, `{ok: false, code, status}`, or a thrown `NetworkError` when no answer
 * arrived (the outcome is unknown; see `@s10n-base/client/query-state`).
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

import { NetworkError } from "@s10n-base/client/rpc";

export type AuthFailure = { readonly ok: false; readonly code: string; readonly status: number };
export type AuthResult<T = unknown> = { readonly ok: true; readonly data: T } | AuthFailure;

export interface Passkey {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
}

export interface WebAuth {
  readonly signUp: (input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthResult>;
  readonly signIn: (input: {
    readonly email: string;
    readonly password: string;
  }) => Promise<AuthResult>;
  readonly signInWithPasskey: () => Promise<AuthResult>;
  readonly signOut: () => Promise<AuthResult>;
  readonly verifyEmail: (token: string) => Promise<AuthResult>;
  readonly sendVerificationEmail: (email: string) => Promise<AuthResult>;
  readonly requestPasswordReset: (email: string) => Promise<AuthResult>;
  readonly resetPassword: (token: string, newPassword: string) => Promise<AuthResult>;
  readonly listPasskeys: () => Promise<AuthResult<Passkey[]>>;
  readonly addPasskey: () => Promise<AuthResult>;
  readonly deletePasskey: (id: string) => Promise<AuthResult>;
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

interface ClientResult {
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
  action: () => Promise<ClientResult>,
): Promise<AuthResult> {
  const before = tracker.failures();
  let result: ClientResult;
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

function toPasskeys(data: unknown): Passkey[] {
  if (!Array.isArray(data)) return [];
  return data.map((item: { id: string; name?: string | null; createdAt: string | Date }) => ({
    id: item.id,
    name: item.name ?? null,
    createdAt: new Date(item.createdAt).toISOString(),
  }));
}

export function createWebAuth(options: {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}): WebAuth {
  const tracker = trackNetworkFailures(
    options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  );
  const client = createAuthClient({
    baseURL: `${options.baseUrl}/api/auth`,
    plugins: [passkeyClient()],
    fetchOptions: { customFetchImpl: tracker.fetch },
  });
  const run = (action: () => Promise<ClientResult>) => runAuthAction(tracker, action);
  return {
    signUp: (input) => run(() => client.signUp.email(input)),
    signIn: (input) => run(() => client.signIn.email(input)),
    signInWithPasskey: () => run(() => client.signIn.passkey()),
    signOut: () => run(() => client.signOut()),
    verifyEmail: (token) => run(() => client.verifyEmail({ query: { token } })),
    sendVerificationEmail: (email) => run(() => client.sendVerificationEmail({ email })),
    requestPasswordReset: (email) => run(() => client.requestPasswordReset({ email })),
    resetPassword: (token, newPassword) => run(() => client.resetPassword({ token, newPassword })),
    listPasskeys: async () => {
      const result = await run(() => client.passkey.listUserPasskeys());
      return result.ok ? { ok: true, data: toPasskeys(result.data) } : result;
    },
    addPasskey: () => run(() => client.passkey.addPasskey()),
    deletePasskey: (id) => run(() => client.passkey.deletePasskey({ id })),
  };
}
