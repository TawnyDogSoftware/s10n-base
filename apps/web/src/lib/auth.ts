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
