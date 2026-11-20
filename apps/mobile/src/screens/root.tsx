/**
 * The root layout: the build's config, the services, translations in the device's language,
 * TanStack Query wired to the app's lifecycle, and the navigator holding the `(auth)` and
 * `(app)` groups.
 */
import "../global.css";

import Constants from "expo-constants";
import { getLocales } from "expo-localization";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";

import { createReactI18n } from "@s10n-base/i18n/react";
import { appVariants } from "@s10n-base/shared/app-variants";

import { readAppExtra } from "../config/runtime";
import { connectQueryLifecycle } from "../lib/query-lifecycle";
import { AppProviders } from "../providers";
import { createServices } from "../services";

/** Everything the app holds for its lifetime, built once from the build's config. */
export function createRoot(
  expoConfig: { readonly extra?: unknown } | null | undefined,
  deviceLocales: ReadonlyArray<{ readonly languageTag: string }>,
) {
  const extra = readAppExtra(expoConfig);
  const scheme = appVariants[extra.appVariant].urlScheme;
  return {
    scheme,
    services: createServices({ apiBaseUrl: extra.apiBaseUrl, scheme }),
    i18n: createReactI18n(deviceLocales.map((locale) => locale.languageTag)),
  };
}

export function RootLayout() {
  const [root] = useState(() => createRoot(Constants.expoConfig, getLocales()));
  useEffect(() => connectQueryLifecycle(), []);
  return (
    <AppProviders services={root.services} i18n={root.i18n}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
