/**
 * The Expo config, built from the environment by one tested function. `app.config.ts` calls it.
 *
 * Expo loads that file with Node, so everything this file and `app.config.ts` import must load in
 * Node as it is: relative imports carry their `.ts` extension, and from the workspace only files
 * that import nothing themselves (the shared variant table, the theme's token reader). Node cannot
 * follow the extensionless imports in the rest of the workspace's TypeScript source.
 */
import type { ExpoConfig } from "expo/config";

import { APP_VARIANTS, type AppVariant, appVariants } from "@s10n-base/shared/app-variants";

import type { NativeColors } from "./theme-colors.ts";

/** The server `bun dev` starts, as an iOS simulator on the same Mac reaches it. */
export const DEVELOPMENT_API_BASE_URL = "http://localhost:4210";

/** The variables `app.config.ts` reads. Everything else in the environment is ignored. */
export interface ExpoConfigEnv {
  readonly [name: string]: string | undefined;
  readonly APP_VARIANT?: string | undefined;
  readonly EXPO_PUBLIC_API_BASE_URL?: string | undefined;
  readonly EAS_PROJECT_ID?: string | undefined;
}

/** What the running app reads from `Constants.expoConfig.extra` (see `runtime.ts`). */
export interface AppExtra {
  readonly appVariant: AppVariant;
  /** The API origin, such as `https://api.example.com`. */
  readonly apiBaseUrl: string;
  readonly eas?: { readonly projectId: string };
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isAppVariant(value: string): value is AppVariant {
  return (APP_VARIANTS as readonly string[]).includes(value);
}

/**
 * `APP_VARIANT`. Unset means a local development build; anything unknown is an error, so a typo
 * can never build the production app.
 */
export function resolveAppVariant(value: string | undefined): AppVariant {
  const variant = trimmed(value);
  if (variant === "") return "development";
  if (!isAppVariant(variant)) {
    throw new Error(
      `APP_VARIANT must be one of ${APP_VARIANTS.join(", ")}; got "${variant}".`,
    );
  }
  return variant;
}

/**
 * `EXPO_PUBLIC_API_BASE_URL` as a bare origin. https is required outside development, and
 * preview and production builds must name their server: a missing value fails the build here
 * rather than the app at run time.
 */
export function resolveApiBaseUrl(variant: AppVariant, value: string | undefined): string {
  const raw = trimmed(value);
  if (raw === "") {
    if (variant === "development") return DEVELOPMENT_API_BASE_URL;
    throw new Error(`EXPO_PUBLIC_API_BASE_URL is required for the ${variant} variant.`);
  }
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (
    url === undefined ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL must be a bare http(s) origin such as https://api.example.com; got "${raw}".`,
    );
  }
  if (url.protocol !== "https:" && variant !== "development") {
    throw new Error(
      `EXPO_PUBLIC_API_BASE_URL must be an https origin for the ${variant} variant; got "${raw}".`,
    );
  }
  return url.origin;
}

/**
 * Builds the Expo config for the variant `APP_VARIANT` selects. `colors` are the theme's, for the
 * splash screen and Android's icon background (see `theme-colors.ts`).
 */
export function buildExpoConfig(env: ExpoConfigEnv, colors: NativeColors): ExpoConfig {
  const variant = resolveAppVariant(env.APP_VARIANT);
  const identity = appVariants[variant];
  const projectId = trimmed(env.EAS_PROJECT_ID);
  const extra: AppExtra = {
    appVariant: variant,
    apiBaseUrl: resolveApiBaseUrl(variant, env.EXPO_PUBLIC_API_BASE_URL),
    ...(projectId === "" ? {} : { eas: { projectId } }),
  };

  return {
    name: identity.displayName,
    slug: "s10n-base",
    scheme: identity.urlScheme,
    version: "0.1.0",
    platforms: ["ios", "android"],
    orientation: "portrait",
    // Light and dark follow the system; the theme has both.
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    ios: {
      bundleIdentifier: identity.bundleIdentifier,
      supportsTablet: true,
      config: { usesNonExemptEncryption: false },
      // The development build talks to a server on your own machine or network over plain
      // http, which App Transport Security blocks unless told otherwise. Preview and production
      // require https (see resolveApiBaseUrl), so they keep the default.
      infoPlist:
        variant === "development" ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {},
    },
    android: {
      package: identity.bundleIdentifier,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: colors.light.background,
      },
    },
    plugins: [
      "expo-router",
      // No biometric prompt guards the stored session, so no Face ID usage string.
      ["expo-secure-store", { faceIDPermission: false }],
      "expo-localization",
      "expo-web-browser",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: colors.light.background,
          dark: { image: "./assets/splash-icon.png", backgroundColor: colors.dark.background },
        },
      ],
    ],
    experiments: { typedRoutes: true },
    extra,
  };
}
