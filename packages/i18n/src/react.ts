/**
 * The apps' i18next instance, wired to React through `react-i18next`. Wrap the app in
 * `<I18nextProvider i18n={createReactI18n(navigator.languages)}>` and call `useTranslation(ns)`.
 */
import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";

import { baseInitOptions, resolveLocale } from "./index";

/**
 * Creates an i18next instance in the first supported language of `languages` (BCP 47 tags, most
 * preferred first), falling back to English. It is ready on return, so the first render is
 * already translated.
 */
export function createReactI18n(languages: readonly string[]): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init(baseInitOptions(resolveLocale(languages), "common"));
  return instance;
}
