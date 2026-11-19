// @vitest-environment node
// The Expo config runs in Node, not in the app.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseThemeModes } from "@s10n-base/theme/tokens";

import { nativeColors, readNativeColors } from "./theme-colors.ts";

const css = readFileSync(new URL("../../../../packages/theme/theme.css", import.meta.url), "utf8");

describe("nativeColors", () => {
  it("takes the background of each mode from the theme", () => {
    const { light, dark } = parseThemeModes(css);

    expect(nativeColors(css)).toEqual({
      light: { background: light["--color-background"] },
      dark: { background: dark["--color-background"] },
    });
  });

  it("refuses a theme without a background, rather than building a blank splash", () => {
    expect(() =>
      nativeColors("@theme {} @layer theme { :root { @variant light {} @variant dark {} } }"),
    ).toThrow("The theme has no --color-background in light mode.");
  });
});

describe("readNativeColors", () => {
  it("reads the theme package's file", () => {
    expect(readNativeColors()).toEqual(nativeColors(css));
  });
});
