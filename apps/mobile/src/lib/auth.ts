/**
 * The mobile app's Better Auth client: Better Auth's Expo plugin keeps the session cookie in
 * SecureStore and sends it itself, since a native app has no browser cookie jar. Results are
 * plain data or a thrown `NetworkError`, as on the web (`@s10n-base/client/auth`).
 */
import {
  expoClient,
  getSetCookie,
  hasBetterAuthCookies,
  storageAdapter,
} from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";
import * as SecureStore from "expo-secure-store";

import {
  type AuthClientResult,
  type PasswordAuth,
  runAuthAction,
  trackNetworkFailures,
} from "@s10n-base/client/auth";
import { AUTH_COOKIE_PREFIX } from "@s10n-base/shared/auth";

/** Where Better Auth is mounted on the server. */
const AUTH_BASE_PATH = "/api/auth";

export interface MobileAuth extends PasswordAuth {
  /** The stored session cookie as a `cookie` header value, or `""` when signed out. */
  readonly cookie: () => Promise<string>;
  /**
   * Stores the auth cookies a response set outside Better Auth's own routes: the renewal the
   * app's session route passes on. Other cookies are ignored.
   */
  readonly storeCookies: (setCookie: string) => Promise<void>;
}

function hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The SecureStore key prefix for one API origin, so a build pointed at another server never sends
 * it this server's session. Hex keeps the key to the characters SecureStore accepts.
 */
export function authStoragePrefix(apiBaseUrl: string): string {
  return `auth_${hex(apiBaseUrl)}`;
}

export function createMobileAuth(options: {
  /** The API origin. */
  readonly baseUrl: string;
  /** The build's URL scheme, which the server trusts as this app's origin. */
  readonly scheme: string;
  readonly fetch?: typeof fetch;
}): MobileAuth {
  const tracker = trackNetworkFailures(
    options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  );
  const client = createAuthClient({
    baseURL: `${options.baseUrl}${AUTH_BASE_PATH}`,
    plugins: [
      expoClient({
        scheme: options.scheme,
        storage: SecureStore,
        storagePrefix: authStoragePrefix(options.baseUrl),
        cookiePrefix: AUTH_COOKIE_PREFIX,
      }),
    ],
    fetchOptions: { customFetchImpl: tracker.fetch },
  });
  const run = (action: () => Promise<AuthClientResult>) => runAuthAction(tracker, action);
  // The same storage format and queue the Expo client uses: both are keyed by SecureStore.
  const storage = storageAdapter(SecureStore);
  const cookieKey = `${authStoragePrefix(options.baseUrl)}_cookie`;
  return {
    signUp: (input) => run(() => client.signUp.email(input)),
    signIn: (input) => run(() => client.signIn.email(input)),
    signOut: () => run(() => client.signOut()),
    sendVerificationEmail: (email) => run(() => client.sendVerificationEmail({ email })),
    requestPasswordReset: (email) => run(() => client.requestPasswordReset({ email })),
    cookie: () => client.getCookie(),
    storeCookies: async (setCookie) => {
      if (!hasBetterAuthCookies(setCookie, AUTH_COOKIE_PREFIX)) return;
      const current = await storage.getItemAsync(cookieKey);
      await storage.setItemAsync(cookieKey, getSetCookie(setCookie, current ?? undefined));
    },
  };
}

/**
 * A `fetch` for the RPC and session clients that sends the stored session cookie itself and
 * keeps the platform's own cookie handling out of it (`credentials: "omit"`), as the Expo client
 * does for Better Auth's routes. Cookies an answer sets go to `storeCookies`: the session route
 * passes on Better Auth's renewal of an active session, which must replace the stored cookie or
 * the session would end seven days after sign-in.
 */
export function withAuthCookie(
  cookie: () => Promise<string>,
  base: typeof fetch = (input, init) => globalThis.fetch(input, init),
  storeCookies: (setCookie: string) => Promise<void> = () => Promise.resolve(),
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const value = await cookie();
    if (value !== "") headers.set("cookie", value);
    const response = await base(input, { ...init, headers, credentials: "omit" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null && setCookie !== "") await storeCookies(setCookie);
    return response;
  };
}
