import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root";

function HomePage() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="max-w-xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">S10N Base</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
          A reusable monorepo scaffold with a typed server boundary.
        </h2>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Create a project from the sidebar, then open its detail view to manage notes and watch
          activity updates arrive live over WebSocket.
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
