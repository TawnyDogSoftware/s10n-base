/**
 * The signed-in user, from the server's app-owned session route. `null` means signed out;
 * `undefined` (from the hook) means not known yet.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { createContext, createElement, type ReactNode, useContext } from "react";

import { type AppSession, AppSessionResponse } from "@s10n-base/contracts";

import { createTransport, DecodeError, type TransportOptions } from "./transport";

const SESSION_PATH = "/api/app-auth/session";

/** The query key of the session. Every other query is purged when its user changes. */
export const SESSION_QUERY_KEY = ["session"] as const;

/** `meta` that keeps a query or mutation when the signed-in user changes. Use it sparingly. */
const PUBLIC_META = { public: true } as const;

export interface SessionClient {
  /**
   * The current session, or `null` when signed out.
   *
   * @throws {NetworkError} when no answer arrived; {DecodeError} or {RpcError} otherwise.
   */
  readonly fetchSession: (signal?: AbortSignal) => Promise<AppSession | null>;
}

const decodeResponse = Schema.decodeUnknownExit(AppSessionResponse);

export function createSessionClient(options: TransportOptions): SessionClient {
  const transport = createTransport(options);
  return {
    fetchSession: async (signal) => {
      const data = await transport.request(SESSION_PATH, {
        method: "GET",
        ...(signal === undefined ? {} : { signal }),
      });
      const decoded = decodeResponse(data);
      if (decoded._tag === "Failure")
        throw new DecodeError("The session does not match AppSession.");
      return decoded.value.session;
    },
  };
}

/**
 * The session query. Public, so it survives the purge it triggers. `networkMode: "always"`: it
 * runs even when the browser says it is offline, because re-reading the session is how an
 * unknown outcome is settled, and TanStack Query would otherwise pause it.
 */
export function sessionQueryOptions(client: SessionClient) {
  return queryOptions({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) => client.fetchSession(signal),
    meta: PUBLIC_META,
    networkMode: "always",
    retry: false,
    staleTime: 30_000,
  });
}

const SessionClientContext = createContext<SessionClient | null>(null);

export function SessionClientProvider(props: {
  readonly client: SessionClient;
  readonly children?: ReactNode;
}) {
  return createElement(SessionClientContext.Provider, { value: props.client }, props.children);
}

function useSessionClient(): SessionClient {
  const client = useContext(SessionClientContext);
  if (client === null) throw new Error("useSession needs a SessionClientProvider above it.");
  return client;
}

/** The session query's state, for screens that show loading and error states. */
export function useSessionQuery() {
  return useQuery(sessionQueryOptions(useSessionClient()));
}

/** The signed-in user, `null` when signed out, `undefined` until known. */
export function useSession(): AppSession | null | undefined {
  return useSessionQuery().data;
}
