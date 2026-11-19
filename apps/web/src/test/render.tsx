import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

import {
  createFakeBackend,
  type FakeBackend,
  ORIGIN,
} from "@s10n-base/client/testing/fake-backend";
import { createReactI18n } from "@s10n-base/i18n/react";

import { type AppRouter, getRouter } from "../router";
import { createServices, type WebServices } from "../services";

export interface RenderedApp {
  readonly router: AppRouter;
  readonly services: WebServices;
  readonly backend: FakeBackend;
  /** The current path and search. */
  readonly location: () => string;
}

/** Renders the whole app at `path`, talking to a fake backend. */
export function renderApp(path: string, backend: FakeBackend = createFakeBackend()): RenderedApp {
  const services = createServices({ origin: ORIGIN, apiBaseUrl: ORIGIN, fetch: backend.fetch });
  const router = getRouter(createMemoryHistory({ initialEntries: [path] }), {
    services,
    i18n: createReactI18n(["en-US"]),
  });
  render(<RouterProvider router={router} />);
  return {
    router,
    services,
    backend,
    location: () => router.state.location.href,
  };
}

/** Waits until the router has finished navigating and shows `href`. */
export async function waitForLocation(app: RenderedApp, href: string) {
  await waitFor(() => expect(app.location()).toBe(href));
}

export function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

export function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}
