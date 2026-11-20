/**
 * The web app's Better Auth client, behind a small interface whose results are plain data:
 * `{ok: true, data}`, `{ok: false, code, status}`, or a thrown `NetworkError` when no answer
 * arrived (the outcome is unknown; see `@s10n-base/client/query-state`). The shared parts are in
 * `@s10n-base/client/auth`; the mobile app wraps its Expo client the same way.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

import {
  type AuthClientResult,
  type AuthResult,
  type CallFetchOptions,
  lostAnswerFetch,
  type PasswordAuth,
  runAuthAction,
} from "@s10n-base/client/auth";

import { DecodeError } from "@s10n-base/client/rpc";

export type { AuthResult } from "@s10n-base/client/auth";

export interface Passkey {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
}

export interface WebAuth extends PasswordAuth {
  readonly signInWithPasskey: () => Promise<AuthResult>;
  readonly verifyEmail: (token: string) => Promise<AuthResult>;
  readonly resetPassword: (token: string, newPassword: string) => Promise<AuthResult>;
  readonly listPasskeys: () => Promise<AuthResult<Passkey[]>>;
  /** Adds a passkey under `name`, so the user can tell it from their others. */
  readonly addPasskey: (name: string) => Promise<AuthResult>;
  readonly deletePasskey: (id: string) => Promise<AuthResult>;
}
/** A creation time as Better Auth sends it (a string, or a Date), or null when it is not one. */
function toTime(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

/** One passkey of the list reply, or null when the item is not one. */
function toPasskey(item: unknown): Passkey | null {
  if (typeof item !== "object" || item === null) return null;
  const { id, name = null, createdAt } = item as Record<string, unknown>;
  const created = toTime(createdAt);
  if (typeof id !== "string" || created === null) return null;
  if (name !== null && typeof name !== "string") return null;
  return { id, name, createdAt: created };
}

/**
 * The list reply as passkeys.
 *
 * @throws {DecodeError} when it is not a list of passkeys: never shown as an empty list.
 */
function toPasskeys(data: unknown): Passkey[] {
  const passkeys = Array.isArray(data) ? data.map(toPasskey) : [null];
  if (passkeys.some((passkey) => passkey === null)) {
    throw new DecodeError("The passkey list does not have the expected shape.");
  }
  return passkeys as Passkey[];
}

export function createWebAuth(options: {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}): WebAuth {
  const base = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  // Every call passes its own fetch (below); this one is for requests a plugin sends without
  // the call's options, such as a passkey ceremony's first.
  const client = createAuthClient({
    baseURL: `${options.baseUrl}/api/auth`,
    plugins: [passkeyClient()],
    fetchOptions: { customFetchImpl: lostAnswerFetch(base) },
  });
  const run = (action: (fetchOptions: CallFetchOptions) => Promise<AuthClientResult>) =>
    runAuthAction(base, action);
  return {
    signUp: (input) => run((fetchOptions) => client.signUp.email({ ...input, fetchOptions })),
    signIn: (input) => run((fetchOptions) => client.signIn.email({ ...input, fetchOptions })),
    signInWithPasskey: () => run((fetchOptions) => client.signIn.passkey({ fetchOptions })),
    signOut: () => run((fetchOptions) => client.signOut({ fetchOptions })),
    verifyEmail: (token) =>
      run((fetchOptions) => client.verifyEmail({ query: { token }, fetchOptions })),
    sendVerificationEmail: (email) =>
      run((fetchOptions) => client.sendVerificationEmail({ email, fetchOptions })),
    requestPasswordReset: (email) =>
      run((fetchOptions) => client.requestPasswordReset({ email, fetchOptions })),
    resetPassword: (token, newPassword) =>
      run((fetchOptions) => client.resetPassword({ token, newPassword, fetchOptions })),
    listPasskeys: async () => {
      const result = await run((fetchOptions) => client.passkey.listUserPasskeys({ fetchOptions }));
      return result.ok ? { ok: true, data: toPasskeys(result.data) } : result;
    },
    addPasskey: (name) => run((fetchOptions) => client.passkey.addPasskey({ name, fetchOptions })),
    deletePasskey: (id) =>
      run((fetchOptions) => client.passkey.deletePasskey({ id, fetchOptions })),
  };
}
