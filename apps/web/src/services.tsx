/**
 * Everything the screens talk to the server through, created once per app (or per test) from
 * the API base URL. Route guards read it from the router context, components from React context.
 */
import { QueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { createSessionGate, type SessionGate } from "@s10n-base/client/query-state";
import { createRpcClient, type RpcClient } from "@s10n-base/client/rpc";
import { createSessionClient } from "@s10n-base/client/session";

import { createWebAuth, type WebAuth } from "./lib/auth";

export interface WebServices {
  /** The page's origin, against which redirect targets are checked. */
  readonly origin: string;
  readonly rpc: RpcClient;
  readonly auth: WebAuth;
  readonly gate: SessionGate;
}

export function createServices(options: {
  readonly origin: string;
  readonly apiBaseUrl: string;
  readonly fetch?: typeof fetch;
}): WebServices {
  const transport = {
    baseUrl: options.apiBaseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  // No automatic retries: a refused request will be refused again, and retrying a lost one is
  // the caller's decision (see NetworkError).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    origin: options.origin,
    rpc: createRpcClient(transport),
    auth: createWebAuth(transport),
    gate: createSessionGate({ queryClient, sessionClient: createSessionClient(transport) }),
  };
}

const ServicesContext = createContext<WebServices | null>(null);

export function ServicesProvider(props: {
  readonly services: WebServices;
  readonly children?: ReactNode;
}) {
  return (
    <ServicesContext.Provider value={props.services}>{props.children}</ServicesContext.Provider>
  );
}

export function useServices(): WebServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error("useServices needs a ServicesProvider above it.");
  return services;
}
