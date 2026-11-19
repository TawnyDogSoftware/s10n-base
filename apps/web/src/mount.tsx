import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createReactI18n } from "@s10n-base/i18n/react";

import { readApiBaseUrl, type WebEnv } from "./config";
import { getRouter } from "./router";
import { createServices } from "./services";

/**
 * Starts the app in `page`'s `#root`: the services for the page's origin (or
 * `VITE_API_BASE_URL`), the language from the browser's list, and the router on the address bar.
 *
 * @throws {Error} when the page has no `#root` element.
 */
export function mountApp(page: Window, env: WebEnv): void {
  const origin = page.location.origin;
  const services = createServices({ origin, apiBaseUrl: readApiBaseUrl(env, origin) });
  const i18n = createReactI18n(page.navigator.languages);
  page.document.documentElement.lang = i18n.language;
  const router = getRouter(createBrowserHistory({ window: page }), { services, i18n });
  const root = page.document.getElementById("root");
  if (root === null) throw new Error("index.html has no #root element.");
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
