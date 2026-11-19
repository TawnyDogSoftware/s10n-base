/**
 * Everything the screens talk to the server through, created once per app (or per test) from
 * the build's API origin. The RPC and session clients are `@s10n-base/client`'s, given the API
 * origin explicitly and a `fetch` that sends the session cookie the auth client keeps.
 */
import { QueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { createSessionGate, type SessionGate } from "@s10n-base/client/query-state";
import { createRpcClient, type RpcClient } from "@s10n-base/client/rpc";
import { createSessionClient } from "@s10n-base/client/session";

import { createMobileAuth, type MobileAuth, withAuthCookie } from "./lib/auth";

export interface MobileServices {
  readonly rpc: RpcClient;
  readonly auth: MobileAuth;
  readonly gate: SessionGate;
}

export function createServices(options: {
  readonly apiBaseUrl: string;
  /** The build's URL scheme. */
  readonly scheme: string;
  readonly fetch?: typeof fetch;
}): MobileServices {
  const auth = createMobileAuth({
    baseUrl: options.apiBaseUrl,
    scheme: options.scheme,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const transport = {
    baseUrl: options.apiBaseUrl,
    fetch: withAuthCookie(auth.cookie, options.fetch, auth.storeCookies),
    credentials: "omit",
  } as const;
  // No automatic retries: a refused request will be refused again, and retrying a lost one is
  // the caller's decision (see NetworkError).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    rpc: createRpcClient(transport),
    auth,
    gate: createSessionGate({ queryClient, sessionClient: createSessionClient(transport) }),
  };
}

const ServicesContext = createContext<MobileServices | null>(null);

export function ServicesProvider(props: {
  readonly services: MobileServices;
  readonly children?: ReactNode;
}) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  );
}

export function useServices(): MobileServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error("useServices needs a ServicesProvider above it.");
  return services;
}
