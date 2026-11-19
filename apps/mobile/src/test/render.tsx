/**
 * Renders a screen the way the app does (services, translations, the session gate) against the
 * fake server in cookie mode, so the auth client stores the session cookie in the fake SecureStore
 * and every request carries it.
 */
import { fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { createFakeBackend, type FakeBackend } from "@s10n-base/client/testing/fake-backend";
import { createReactI18n } from "@s10n-base/i18n/react";
import { appVariants } from "@s10n-base/shared/app-variants";

import { AppProviders } from "../providers";
import { createServices, type MobileServices } from "../services";

export const API = "http://localhost:4210";

export function createBackend(): FakeBackend {
  return createFakeBackend({ origin: API, cookies: true });
}

export interface Rendered {
  readonly backend: FakeBackend;
  readonly services: MobileServices;
  readonly result: RenderResult;
}

export function createTestServices(backend: FakeBackend): MobileServices {
  return createServices({
    apiBaseUrl: API,
    scheme: appVariants.development.urlScheme,
    fetch: backend.fetch,
  });
}

/** Signs in through the app's own auth client, so the cookie is stored as the app stores it. */
export async function signIn(services: MobileServices, email: string, password = "correct horse") {
  const result = await services.auth.signIn({ email, password });
  if (!result.ok) throw new Error(`Could not sign in as ${email}: ${result.code}`);
}

export function renderScreen(
  ui: ReactElement,
  options: { readonly backend?: FakeBackend; readonly services?: MobileServices } = {},
): Rendered {
  const backend = options.backend ?? createBackend();
  const services = options.services ?? createTestServices(backend);
  const result = render(
    <AppProviders services={services} i18n={createReactI18n(["en-US"])}>
      {ui}
    </AppProviders>,
  );
  return { backend, services, result };
}

export function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

export function press(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}
