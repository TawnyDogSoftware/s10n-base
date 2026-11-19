import { createRouter, type RouterHistory } from "@tanstack/react-router";
import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { SessionGateProvider } from "@s10n-base/client/query-state";

import { NotFound, RouteError } from "./components/RouteStates";
import { parseSearch, stringifySearch } from "./lib/search";
import { adminUsersRoute } from "./routes/admin-users";
import { authedRoute } from "./routes/authed";
import { forgotPasswordRoute } from "./routes/forgot-password";
import { homeRoute } from "./routes/home";
import { profileRoute } from "./routes/profile";
import { resetPasswordRoute } from "./routes/reset-password";
import { rootRoute } from "./routes/root";
import { signInRoute } from "./routes/sign-in";
import { signUpRoute } from "./routes/sign-up";
import { verifyEmailRoute } from "./routes/verify-email";
import { ServicesProvider, type WebServices } from "./services";

const routeTree = rootRoute.addChildren([
  signUpRoute,
  signInRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  authedRoute.addChildren([homeRoute, profileRoute, adminUsersRoute]),
]);

export interface RouterDependencies {
  readonly services: WebServices;
  readonly i18n: i18n;
}

export function getRouter(history: RouterHistory, dependencies: RouterDependencies) {
  const { services } = dependencies;
  return createRouter({
    routeTree,
    history,
    context: { services },
    // Every search value stays the string in the URL; see lib/search.ts.
    parseSearch,
    stringifySearch,
    scrollRestoration: false,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    Wrap: ({ children }: { readonly children: ReactNode }) => (
      <I18nextProvider i18n={dependencies.i18n}>
        <ServicesProvider services={services}>
          <SessionGateProvider gate={services.gate}>{children}</SessionGateProvider>
        </ServicesProvider>
      </I18nextProvider>
    ),
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
