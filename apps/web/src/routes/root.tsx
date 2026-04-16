import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";

import { AppShell } from "../components/AppShell";

export const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
