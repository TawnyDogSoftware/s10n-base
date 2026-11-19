import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { appVariants } from "../../packages/shared/src/app-variants";
import { checkPrebuild, checkPrebuildCommand, type PrebuildFiles } from "./check-prebuild";

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

  it("says a name is missing when a project has none", () => {
    expect(checkPrebuild(files({ androidStrings: "<resources/>" }), "development")).toEqual([
      `the Android app name is missing, expected ${dev.displayName}`,
    ]);
  });

  it("checks against the variant asked for", () => {
    expect(checkPrebuild(files(), "production")).toHaveLength(6);
  });
});

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** An app directory holding generated native projects with `content`. */
function generatedApp(content: PrebuildFiles): string {
  const app = mkdtempSync(path.join(tmpdir(), "prebuild-"));
  roots.push(app);
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    writeFileSync(path.join(app, file), text);
  };
  write("ios/App.xcodeproj/project.pbxproj", content.pbxproj);
  write("ios/App/Info.plist", content.infoPlist);
  write("android/app/build.gradle", content.buildGradle);
  write("android/app/src/main/AndroidManifest.xml", content.androidManifest);
  write("android/app/src/main/res/values/strings.xml", content.androidStrings);
  return app;
}

function capture() {
  const lines: string[] = [];
  return {
    lines,
    out: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(`! ${line}`),
    },
  };
}

describe("checkPrebuildCommand", () => {
  it("passes generated projects that carry the variant's identity", () => {
    const { lines, out } = capture();

    expect(checkPrebuildCommand([generatedApp(files()), "development"], out)).toBe(0);
    expect(lines).toEqual(["The native projects carry the development variant's identity."]);
  });

  it("lists every mismatch and exits 1", () => {
    const { lines, out } = capture();

    expect(checkPrebuildCommand([generatedApp(files()), "production"], out)).toBe(1);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.startsWith("! "))).toBe(true);
  });

  it("exits 2 for an unknown variant or a directory without native projects", () => {
    const unknown = capture();
    expect(checkPrebuildCommand(["apps/mobile", "staging"], unknown.out)).toBe(2);
    expect(unknown.lines).toEqual(["! Unknown variant staging."]);

    const empty = mkdtempSync(path.join(tmpdir(), "prebuild-empty-"));
    roots.push(empty);
    mkdirSync(path.join(empty, "ios"));
    const missing = capture();
    expect(checkPrebuildCommand([empty], missing.out)).toBe(2);
    expect(missing.lines).toEqual([`! No Xcode project in ${path.join(empty, "ios")}.`]);
  });
});
