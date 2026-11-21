/**
 * Fakes for the native modules, installed by `setup.ts` at their import boundary. Each is a plain
 * object a test can read or drive: what SecureStore holds, where the router went, the network
 * state listeners.
 */
import { createElement, type ReactNode } from "react";
import { Text } from "react-native";
import { vi } from "vitest";

/** What the fake SecureStore holds, by key. */
export const secureStore = new Map<string, string>();

export const expoSecureStoreModule = {
  getItem: (key: string) => secureStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    secureStore.set(key, value);
  },
  getItemAsync: (key: string) => Promise.resolve(secureStore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  },
};

/** The router every screen gets from the mocked `useRouter()` and `router`. */
export const router = {
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
  back: vi.fn<() => void>(),
};

function Navigator(props: { readonly children?: ReactNode }) {
  return props.children ?? null;
}

function Screen() {
  return null;
}

/**
 * `expo-router` as the screens use it: navigation is recorded on {@link router}, `<Redirect>`
 * renders its target so a test can see it, and a `<Stack>` renders nothing of its own (tests
 * render a layout's screens themselves).
 */
export const expoRouterModule = {
  useRouter: () => router,
  router,
  Redirect: (props: { readonly href: string }) =>
    createElement(Text, { testID: "redirect" }, props.href),
  Link: (props: { readonly href: string; readonly children?: ReactNode }) =>
    createElement(
      Text,
      {
        role: "link",
        onPress: () => {
          router.push(props.href);
        },
      },
      props.children,
    ),
  Stack: Object.assign(Navigator, { Screen }),
  Slot: () => null,
};

export interface FakeNetworkState {
  isConnected?: boolean | undefined;
  isInternetReachable?: boolean | undefined;
}

/** Listeners registered through the mocked `addNetworkStateListener()`. */
export const networkListeners = new Set<(state: FakeNetworkState) => void>();

/** Tells every listener the network changed. */
export function setNetwork(state: FakeNetworkState): void {
  for (const listener of networkListeners) listener(state);
}

export const expoNetworkModule = {
  addNetworkStateListener: (listener: (state: FakeNetworkState) => void) => {
    networkListeners.add(listener);
    return { remove: () => networkListeners.delete(listener) };
  },
};

/** The device's preferred languages, as `expo-localization` reports them. */
export const locales: Array<{ languageTag: string }> = [{ languageTag: "en-US" }];

export const expoLocalizationModule = {
  getLocales: () => locales,
};

/** `expo-linking`: the URL a native build would make for the scheme. */
export const expoLinkingModule = {
  createURL: (path: string, options?: { scheme?: string }) =>
    `${options?.scheme ?? "exp"}://${path.replace(/^\//, "")}`,
};

/** `expo-constants`: a development build pointed at the fake server. */
export const expoConstantsModule = {
  default: {
    expoConfig: { extra: { appVariant: "development", apiBaseUrl: "http://localhost:4210" } },
    platform: {},
  },
};
