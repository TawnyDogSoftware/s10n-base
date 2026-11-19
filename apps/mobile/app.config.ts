import type { ExpoConfig } from "expo/config";

import { buildExpoConfig } from "./src/config/expo-config.ts";
import { readNativeColors } from "./src/config/theme-colors.ts";

/** Expo reads this at build time. `APP_VARIANT` picks the development, preview or production app. */
export default function appConfig(): ExpoConfig {
  return buildExpoConfig(process.env, readNativeColors());
}
