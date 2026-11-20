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
  type CallFetchOptions,
  lostAnswerFetch,
  type PasswordAuth,
  runAuthAction,
} from "@s10n-base/client/auth";
import { AUTH_COOKIE_PREFIX } from "@s10n-base/shared/auth";

/** Where Better Auth is mounted on the server. */
const AUTH_BASE_PATH = "/api/auth";

/** The stored session cookie, as the RPC and session clients' `fetch` uses it. */
export interface CookieSession {
  /** The stored session cookie as a `cookie` header value, or `""` when signed out. */
  readonly cookie: () => Promise<string>;
  /**
   * Goes up when a sign-in, sign-up or sign-out starts and when it ends: an answer to a request
   * sent at another generation belongs to a session that may no longer be the stored one.
   */
  readonly generation: () => number;
  /**
   * Stores the auth cookies a response set outside Better Auth's own routes: the renewal the
   * app's session route passes on. Other cookies are ignored, and so is a response to a request
   * sent at a generation other than the current one.
   */
  readonly storeCookies: (setCookie: string, sentAt: number) => Promise<void>;
}

export interface MobileAuth extends PasswordAuth, CookieSession {}

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
  const base = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
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
    // Every call passes its own fetch (below), so only its own requests decide its outcome.
    fetchOptions: { customFetchImpl: lostAnswerFetch(base) },
  });
  const run = (action: (fetchOptions: CallFetchOptions) => Promise<AuthClientResult>) =>
    runAuthAction(base, action);
  let generation = 0;
  /** An action that changes the stored session: the generation moves before and after it. */
  const changing = async <T>(action: () => Promise<T>): Promise<T> => {
    generation += 1;
    try {
      return await action();
    } finally {
      generation += 1;
    }
  };
  // The same storage format and queue the Expo client uses: both are keyed by SecureStore.
  const storage = storageAdapter(SecureStore);
  const cookieKey = `${authStoragePrefix(options.baseUrl)}_cookie`;
  return {
    signUp: (input) =>
      changing(() => run((fetchOptions) => client.signUp.email({ ...input, fetchOptions }))),
    signIn: (input) =>
      changing(() => run((fetchOptions) => client.signIn.email({ ...input, fetchOptions }))),
    signOut: () => changing(() => run((fetchOptions) => client.signOut({ fetchOptions }))),
    sendVerificationEmail: (email) =>
      run((fetchOptions) => client.sendVerificationEmail({ email, fetchOptions })),
    requestPasswordReset: (email) =>
      run((fetchOptions) => client.requestPasswordReset({ email, fetchOptions })),
    cookie: () => client.getCookie(),
    generation: () => generation,
    storeCookies: async (setCookie, sentAt) => {
      if (sentAt !== generation || !hasBetterAuthCookies(setCookie, AUTH_COOKIE_PREFIX)) return;
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
 * the session would end seven days after sign-in, unless a sign-in or sign-out ran meanwhile: the
 * renewal then belongs to a session that is no longer the stored one.
 */
export function withAuthCookie(
  session: CookieSession,
  base: typeof fetch = (input, init) => globalThis.fetch(input, init),
): typeof fetch {
  return async (input, init) => {
    const sentAt = session.generation();
    const headers = new Headers(init?.headers);
    const value = await session.cookie();
    if (value !== "") headers.set("cookie", value);
    const response = await base(input, { ...init, headers, credentials: "omit" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null && setCookie !== "") await session.storeCookies(setCookie, sentAt);
    return response;
  };
}
