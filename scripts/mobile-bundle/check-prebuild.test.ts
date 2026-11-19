import { describe, expect, it } from "vitest";

import { appVariants } from "../../packages/shared/src/app-variants";
import { checkPrebuild, type PrebuildFiles } from "./check-prebuild";

const dev = appVariants.development;

function files(overrides: Partial<PrebuildFiles> = {}): PrebuildFiles {
  return {
    pbxproj: `PRODUCT_BUNDLE_IDENTIFIER = "${dev.bundleIdentifier}";\nPRODUCT_BUNDLE_IDENTIFIER = "${dev.bundleIdentifier}";`,
    infoPlist: `<key>CFBundleDisplayName</key>\n    <string>${dev.displayName}</string>\n<key>CFBundleURLSchemes</key>\n<array>\n  <string>${dev.urlScheme}</string>\n</array>`,
    buildGradle: `namespace '${dev.bundleIdentifier}'\n        applicationId '${dev.bundleIdentifier}'`,
    androidManifest: `<data android:scheme="${dev.urlScheme}"/>`,
    androidStrings: `<string name="app_name">${dev.displayName}</string>`,
    ...overrides,
  };
}

describe("checkPrebuild", () => {
  it("passes projects that carry the variant's bundle identifier, scheme and name", () => {
    expect(checkPrebuild(files(), "development")).toEqual([]);
  });

  it("reports each identity that does not match", () => {
    const problems = checkPrebuild(
      files({
        pbxproj: 'PRODUCT_BUNDLE_IDENTIFIER = "com.example.other";',
        androidManifest: '<data android:scheme="other"/>',
        androidStrings: '<string name="app_name">Other</string>',
      }),
      "development",
    );

    expect(problems).toEqual([
      `iOS bundle identifiers are com.example.other, expected ${dev.bundleIdentifier}`,
      `the Android manifest does not declare the ${dev.urlScheme} scheme`,
      `the Android app name is Other, expected ${dev.displayName}`,
    ]);
  });

  it("checks against the variant asked for", () => {
    expect(checkPrebuild(files(), "production")).toHaveLength(6);
  });
});
