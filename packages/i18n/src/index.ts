/**
 * The catalogs and i18next setup shared by the web app, the mobile app and the server's emails.
 * Keys are typed: a key that does not exist in English is a compile error.
 */
import i18next, { type InitOptions, type TFunction } from "i18next";

import { type Catalog, en } from "./locales/en";

export type { Catalog } from "./locales/en";

/** The locale every catalog falls back to. English is the only one so far. */
export const DEFAULT_LOCALE = "en";

/** Every catalog, by locale. A new locale must have exactly English's keys (a test checks). */
export const resources = { en } as const satisfies Record<string, Catalog>;

/** A locale with a catalog. */
export type Locale = keyof typeof resources;

/** An i18next namespace: one top-level key of a catalog. */
export type Namespace = keyof (typeof resources)[typeof DEFAULT_LOCALE];

export const NAMESPACES = [
  "common",
  "auth",
  "profile",
  "admin",
  "errors",
  "email",
] as const satisfies readonly Namespace[];

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    // Typed keys: a missing or misspelled key is a compile error.
    resources: (typeof resources)[typeof DEFAULT_LOCALE];
  }
}

function isLocale(code: string): code is Locale {
  return Object.hasOwn(resources, code);
}

/**
 * The first supported locale among `codes` (BCP 47 tags such as `en-GB`, most preferred first),
 * matched by language subtag, or English.
 */
export function resolveLocale(codes: readonly string[]): Locale {
  for (const code of codes) {
    const language = code.split("-")[0]?.toLowerCase() ?? "";
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

/**
 * Options for every i18next instance: inline resources, so `initAsync: false` initialises
 * synchronously and the first render or email is already translated; English as the fallback;
 * no HTML escaping, because React escapes and the email renderer escapes for itself.
 */
export function baseInitOptions(locale: Locale, defaultNS: Namespace): InitOptions {
  return {
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...NAMESPACES],
    defaultNS,
    initAsync: false,
    interpolation: { escapeValue: false },
  };
}

/** A translator for one namespace, ready on return. The server uses it for emails. */
export function createTranslator<N extends Namespace>(
  namespace: N,
  locale: Locale = DEFAULT_LOCALE,
): TFunction<N> {
  const instance = i18next.createInstance();
  void instance.init(baseInitOptions(locale, namespace));
  return instance.getFixedT(locale, namespace);
}

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A key of the `errors` namespace. */
export type ErrorMessageKey = Leaves<(typeof resources)[typeof DEFAULT_LOCALE]["errors"]>;

function hasMessage(path: readonly string[]): boolean {
  let node: unknown = resources[DEFAULT_LOCALE].errors;
  for (const part of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

/**
 * The `errors` key for an `AppError` code from the server (such as `auth.unauthenticated`), or
 * `generic` for a code with no message.
 */
export function appErrorKey(code: string): ErrorMessageKey {
  return hasMessage(code.split(".")) ? (code as ErrorMessageKey) : "generic";
}

/** The `errors` key for a Better Auth error code (such as `INVALID_TOKEN`), or `generic`. */
export function authErrorKey(code: string): ErrorMessageKey {
  return hasMessage(["betterAuth", code]) ? (`betterAuth.${code}` as ErrorMessageKey) : "generic";
}

/** The Better Auth error codes the screens have a message for. */
export const AUTH_ERROR_CODES = Object.keys(resources[DEFAULT_LOCALE].errors.betterAuth);
