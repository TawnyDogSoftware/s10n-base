import { createRootRouteWithContext } from "@tanstack/react-router";

import { AppShell } from "../components/AppShell";
import type { RouterContext } from "./guards";

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
});
