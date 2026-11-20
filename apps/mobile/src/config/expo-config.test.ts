// @vitest-environment node
// The Expo config runs in Node, not in the app.
import { describe, expect, it } from "vitest";

import { appVariants } from "@s10n-base/shared/app-variants";

import {
  buildExpoConfig as build,
  DEVELOPMENT_API_BASE_URL,
  type ExpoConfigEnv,
} from "./expo-config.ts";

const COLORS = { light: { background: "#fefefe" }, dark: { background: "#010101" } };
const buildExpoConfig = (env: ExpoConfigEnv) => build(env, COLORS);

const HTTPS = "https://api.example.com";

function devClient(env: ExpoConfigEnv) {
  return buildExpoConfig(env).plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-dev-client",
  );
}

describe("buildExpoConfig", () => {
  it.each(["development", "preview", "production"] as const)(
    "takes the %s variant's name, scheme and bundle identifier from the shared table",
    (variant) => {
      const config = buildExpoConfig({ APP_VARIANT: variant, EXPO_PUBLIC_API_BASE_URL: HTTPS });
      const identity = appVariants[variant];

      expect(config.name).toBe(identity.displayName);
      expect(config.scheme).toBe(identity.urlScheme);
      expect(config.ios?.bundleIdentifier).toBe(identity.bundleIdentifier);
      expect(config.android?.package).toBe(identity.bundleIdentifier);
      expect(config.extra).toMatchObject({ appVariant: variant, apiBaseUrl: HTTPS });
    },
  );

  it("builds the development variant when APP_VARIANT is unset or blank", () => {
    for (const value of [undefined, "", "  "]) {
      expect(buildExpoConfig({ APP_VARIANT: value }).extra).toMatchObject({
        appVariant: "development",
      });
    }
  });

  it("refuses an unknown variant, so a typo never builds the wrong app", () => {
    expect(() => buildExpoConfig({ APP_VARIANT: "staging" })).toThrow(
      'APP_VARIANT must be one of development, preview, production; got "staging".',
    );
  });

  it("points development at the local server by default", () => {
    expect(buildExpoConfig({}).extra).toMatchObject({ apiBaseUrl: DEVELOPMENT_API_BASE_URL });
    expect(DEVELOPMENT_API_BASE_URL).toBe("http://localhost:4210");
  });

  it("accepts plain http in development only", () => {
    expect(
      buildExpoConfig({ EXPO_PUBLIC_API_BASE_URL: "http://dev-machine.example.com:4210" }).extra,
    ).toMatchObject({ apiBaseUrl: "http://dev-machine.example.com:4210" });
    for (const variant of ["preview", "production"]) {
      expect(() =>
        buildExpoConfig({
          APP_VARIANT: variant,
          EXPO_PUBLIC_API_BASE_URL: "http://api.example.com",
        }),
      ).toThrow(`EXPO_PUBLIC_API_BASE_URL must be an https origin for the ${variant} variant`);
    }
  });

  it.each(["preview", "production"])(
    "fails at config time when the %s variant has no API URL",
    (variant) => {
      expect(() => buildExpoConfig({ APP_VARIANT: variant })).toThrow(
        `EXPO_PUBLIC_API_BASE_URL is required for the ${variant} variant.`,
      );
      expect(() =>
        buildExpoConfig({ APP_VARIANT: variant, EXPO_PUBLIC_API_BASE_URL: " " }),
      ).toThrow(`EXPO_PUBLIC_API_BASE_URL is required for the ${variant} variant.`);
    },
  );

  it.each([
    "api.example.com",
    "ftp://api.example.com",
    "https://api.example.com/api",
    "https://api.example.com/?x=1",
    "https://api.example.com/#x",
    "https://user:secret@api.example.com",
    "not a url",
  ])("refuses %s, which is not a bare origin", (value) => {
    expect(() =>
      buildExpoConfig({ APP_VARIANT: "production", EXPO_PUBLIC_API_BASE_URL: value }),
    ).toThrow("EXPO_PUBLIC_API_BASE_URL must be");
  });

  it("normalises the origin: trailing slash, case and default port", () => {
    expect(
      buildExpoConfig({
        APP_VARIANT: "production",
        EXPO_PUBLIC_API_BASE_URL: " HTTPS://API.Example.com:443/ ",
      }).extra,
    ).toMatchObject({ apiBaseUrl: "https://api.example.com" });
  });

  it("adds the EAS project id only when one is set", () => {
    expect(buildExpoConfig({}).extra).not.toHaveProperty("eas");
    expect(buildExpoConfig({ EAS_PROJECT_ID: " " }).extra).not.toHaveProperty("eas");
    expect(buildExpoConfig({ EAS_PROJECT_ID: "abc-123" }).extra).toMatchObject({
      eas: { projectId: "abc-123" },
    });
  });

  it("follows the system's light or dark mode and turns on typed routes", () => {
    const config = buildExpoConfig({});

    expect(config.userInterfaceStyle).toBe("automatic");
    expect(config.experiments?.typedRoutes).toBe(true);
  });

  it("allows plain http loads on iOS in the development variant only", () => {
    expect(buildExpoConfig({}).ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: true,
    });
    expect(
      buildExpoConfig({ APP_VARIANT: "production", EXPO_PUBLIC_API_BASE_URL: HTTPS }).ios
        ?.infoPlist,
    ).not.toHaveProperty("NSAppTransportSecurity");
  });

  it("lists the config plugins of the native modules the app uses", () => {
    const names = (buildExpoConfig({}).plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );

    expect(names).toEqual([
      "expo-router",
      "expo-dev-client",
      "expo-secure-store",
      "expo-localization",
      "expo-web-browser",
      "expo-splash-screen",
    ]);
  });

  it("gives only the development variant the dev client's own URL scheme", () => {
    // The dev client's scheme comes from the slug, which every variant shares, so two installed
    // variants would both claim it.
    expect(devClient({})).toEqual(["expo-dev-client", { addGeneratedScheme: true }]);
    expect(devClient({ APP_VARIANT: "preview", EXPO_PUBLIC_API_BASE_URL: HTTPS })).toEqual([
      "expo-dev-client",
      { addGeneratedScheme: false },
    ]);
  });

  it("turns over-the-air updates off, since expo-updates is not installed", () => {
    expect(buildExpoConfig({}).updates).toEqual({ enabled: false });
  });

  it("uses the generated placeholder images on the theme's background colours", () => {
    const config = buildExpoConfig({});
    const splash = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );

    expect(config.icon).toBe("./assets/icon.png");
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#fefefe",
    });
    expect(splash).toEqual([
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#fefefe",
        dark: { image: "./assets/splash-icon.png", backgroundColor: "#010101" },
      },
    ]);
  });
});
