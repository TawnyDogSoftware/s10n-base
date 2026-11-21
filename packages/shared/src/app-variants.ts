/**
 * The mobile app's build variants. Each one installs side by side with the others, so each has
 * its own URL scheme, bundle identifier and name. The server reads this table for the origins it
 * trusts (the scheme of its own `APP_VARIANT`), and the Expo config reads it for the app's
 * identity, so the two cannot disagree. The values are placeholders: a project replaces them with
 * its own before its first store build, since a bundle identifier cannot change after that.
 *
 * This file imports nothing: Expo loads `apps/mobile/app.config.ts` through Node, which cannot
 * follow the extensionless imports the rest of the workspace uses.
 */
export const APP_VARIANTS = ["development", "preview", "production"] as const;
export type AppVariant = (typeof APP_VARIANTS)[number];

export interface AppVariantInfo {
  /** The deep-link scheme, without `://`. */
  readonly urlScheme: string;
  /** The iOS bundle identifier and the Android application id. */
  readonly bundleIdentifier: string;
  /** The name shown under the app icon. */
  readonly displayName: string;
}

export const appVariants: Readonly<Record<AppVariant, AppVariantInfo>> = {
  development: {
    urlScheme: "s10nbase-dev",
    bundleIdentifier: "com.example.s10nbase.dev",
    displayName: "S10N Base (Dev)",
  },
  preview: {
    urlScheme: "s10nbase-preview",
    bundleIdentifier: "com.example.s10nbase.preview",
    displayName: "S10N Base (Preview)",
  },
  production: {
    urlScheme: "s10nbase",
    bundleIdentifier: "com.example.s10nbase",
    displayName: "S10N Base",
  },
};
