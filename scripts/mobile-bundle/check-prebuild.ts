/**
 * Checks the native projects `expo prebuild` generated against the variant table: the iOS bundle
 * identifier, URL scheme and display name, and the Android application id, scheme and app name.
 * pod install and Gradle need macOS and the Android SDK, so this is what Linux can check.
 *
 * Usage: `bun scripts/mobile-bundle/check-prebuild.ts apps/mobile development`, after
 * `bunx expo prebuild --no-install --platform all` in `apps/mobile`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { APP_VARIANTS, type AppVariant, appVariants } from "../../packages/shared/src/app-variants";

export interface PrebuildFiles {
  readonly pbxproj: string;
  readonly infoPlist: string;
  readonly buildGradle: string;
  readonly androidManifest: string;
  readonly androidStrings: string;
}

const all = (text: string, pattern: RegExp) =>
  [...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ""))].sort();

/** Everything that does not match the variant, as sentences; empty when it all matches. */
export function checkPrebuild(files: PrebuildFiles, variant: AppVariant): string[] {
  const identity = appVariants[variant];
  const problems: string[] = [];
  const iosIds = all(files.pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g);
  if (iosIds.join() !== identity.bundleIdentifier) {
    problems.push(
      `iOS bundle identifiers are ${iosIds.join(", ")}, expected ${identity.bundleIdentifier}`,
    );
  }
  if (!all(files.infoPlist, /<string>([^<]+)<\/string>/g).includes(identity.urlScheme)) {
    problems.push(`the iOS Info.plist does not declare the ${identity.urlScheme} scheme`);
  }
  const iosName = /<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/.exec(
    files.infoPlist,
  )?.[1];
  if (iosName !== identity.displayName) {
    problems.push(`the iOS display name is ${iosName}, expected ${identity.displayName}`);
  }
  const androidIds = all(files.buildGradle, /applicationId '([^']+)'/g);
  if (androidIds.join() !== identity.bundleIdentifier) {
    problems.push(
      `the Android application id is ${androidIds.join(", ")}, expected ${identity.bundleIdentifier}`,
    );
  }
  if (!all(files.androidManifest, /android:scheme="([^"]+)"/g).includes(identity.urlScheme)) {
    problems.push(`the Android manifest does not declare the ${identity.urlScheme} scheme`);
  }
  const androidName = /<string name="app_name">([^<]*)<\/string>/.exec(files.androidStrings)?.[1];
  if (androidName !== identity.displayName) {
    problems.push(`the Android app name is ${androidName}, expected ${identity.displayName}`);
  }
  return problems;
}

function read(appRoot: string): PrebuildFiles {
  const ios = path.join(appRoot, "ios");
  const project = readdirSync(ios).find((entry) => entry.endsWith(".xcodeproj"));
  if (project === undefined) throw new Error(`No Xcode project in ${ios}.`);
  const target = project.slice(0, -".xcodeproj".length);
  const android = path.join(appRoot, "android", "app");
  return {
    pbxproj: readFileSync(path.join(ios, project, "project.pbxproj"), "utf8"),
    infoPlist: readFileSync(path.join(ios, target, "Info.plist"), "utf8"),
    buildGradle: readFileSync(path.join(android, "build.gradle"), "utf8"),
    androidManifest: readFileSync(path.join(android, "src/main/AndroidManifest.xml"), "utf8"),
    androidStrings: readFileSync(path.join(android, "src/main/res/values/strings.xml"), "utf8"),
  };
}

if (import.meta.main) {
  const [appRoot = "apps/mobile", variant = "development"] = process.argv.slice(2);
  if (!(APP_VARIANTS as readonly string[]).includes(variant)) {
    console.error(`Unknown variant ${variant}.`);
    process.exit(2);
  }
  const problems = checkPrebuild(read(appRoot), variant as AppVariant);
  for (const problem of problems) console.error(problem);
  if (problems.length === 0)
    console.log(`The native projects carry the ${variant} variant's identity.`);
  process.exit(problems.length === 0 ? 0 : 1);
}
