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
  type PasswordAuth,
  runAuthAction,
  trackNetworkFailures,
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
  readonly addPasskey: () => Promise<AuthResult>;
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
  const tracker = trackNetworkFailures(
    options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  );
  const client = createAuthClient({
    baseURL: `${options.baseUrl}/api/auth`,
    plugins: [passkeyClient()],
    fetchOptions: { customFetchImpl: tracker.fetch },
  });
  const run = (action: () => Promise<AuthClientResult>) => runAuthAction(tracker, action);
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
