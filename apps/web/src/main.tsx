import { createBrowserHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createReactI18n } from "@s10n-base/i18n/react";

import "./index.css";

import { readApiBaseUrl } from "./config";
import { getRouter } from "./router";
import { createServices } from "./services";

const origin = window.location.origin;
const services = createServices({
  origin,
  apiBaseUrl: readApiBaseUrl(import.meta.env, origin),
});
const i18n = createReactI18n(navigator.languages);
document.documentElement.lang = i18n.language;
const router = getRouter(createBrowserHistory(), { services, i18n });

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
