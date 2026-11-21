/**
 * The providers every screen needs: services, translations and the session gate (which brings
 * the query client). The root layout and the tests both use this, so tests render screens the
 * way the app does.
 */
import type { i18n as I18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { SessionGateProvider } from "@s10n-base/client/query-state";

import { type MobileServices, ServicesProvider } from "./services";

export function AppProviders(props: {
  readonly services: MobileServices;
  readonly i18n: I18n;
  readonly children?: ReactNode;
}) {
  return (
    <ServicesProvider services={props.services}>
      <I18nextProvider i18n={props.i18n}>
        <SessionGateProvider gate={props.services.gate}>{props.children}</SessionGateProvider>
      </I18nextProvider>
    </ServicesProvider>
  );
}
