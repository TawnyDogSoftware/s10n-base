import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root";

function HomePage() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="max-w-xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-slate-900">
          A monorepo scaffold with a typed server boundary.
        </h2>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The web app reads its configuration from the server, which also answers a health check and
          an RPC endpoint with no methods yet.
        </p>
      </div>
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
