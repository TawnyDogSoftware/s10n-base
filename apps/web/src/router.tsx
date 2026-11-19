import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { homeRoute } from "./routes/home";
import { rootRoute } from "./routes/root";

const routeTree = rootRoute.addChildren([homeRoute]);

export function getRouter(history: RouterHistory) {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    history,
    scrollRestoration: false,
    context: {
      queryClient,
    },
    Wrap: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
