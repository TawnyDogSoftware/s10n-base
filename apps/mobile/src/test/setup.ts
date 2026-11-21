import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { Platform } from "react-native";
import { afterEach, vi } from "vitest";

import { networkListeners, router, secureStore } from "./native";

// react-native-web reports "web"; the screens are tested as the phone app they ship as, which is
// also what makes Better Auth's Expo client store cookies instead of leaving them to a browser.
Object.assign(Platform, { OS: "ios" });

// Native modules are replaced at their import boundary.
vi.mock("expo-secure-store", async () => (await import("./native")).expoSecureStoreModule);
vi.mock("expo-router", async () => (await import("./native")).expoRouterModule);
vi.mock("expo-network", async () => (await import("./native")).expoNetworkModule);
vi.mock("expo-localization", async () => (await import("./native")).expoLocalizationModule);
vi.mock("expo-linking", async () => (await import("./native")).expoLinkingModule);
vi.mock("expo-constants", async () => (await import("./native")).expoConstantsModule);
vi.mock("expo-web-browser", () => ({}));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));

// Vitest's globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  secureStore.clear();
  networkListeners.clear();
  router.push.mockReset();
  router.replace.mockReset();
  router.back.mockReset();
  vi.restoreAllMocks();
});
