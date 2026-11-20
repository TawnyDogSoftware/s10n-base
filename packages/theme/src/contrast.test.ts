import { describe, expect, it } from "vitest";

import { contrastRatio, parseHexColor, parseThemeModes, relativeLuminance } from "./contrast";

describe("parseHexColor", () => {
  it("reads six- and three-digit hex colours", () => {
    expect(parseHexColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHexColor("#1D4ED8")).toEqual([29, 78, 216]);
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
  });

  it.each(["red", "#ff", "#gggggg", "rgb(0 0 0)", "#ffffff80"])("refuses %s", (value) => {
    expect(() => parseHexColor(value)).toThrow(/hex colour/);
  });
});

describe("contrastRatio", () => {
  it("matches WCAG's reference values", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is the classic lightest grey that passes AA for text.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#ffffff", "#767676")).toBeCloseTo(4.54, 2);
  });
});

describe("parseThemeModes", () => {
  it("reads the light and dark blocks of a theme file", () => {
    const css = `
      @theme { --color-background: #ffffff; --radius-md: 0.5rem; }
      @layer theme {
        :root {
          @variant light { --color-background: #ffffff; --color-foreground: #000; }
          @variant dark { --color-background: #000000; --color-foreground: #fff; }
        }
      }`;

    expect(parseThemeModes(css)).toEqual({
      defaults: { "--color-background": "#ffffff", "--radius-md": "0.5rem" },
      light: { "--color-background": "#ffffff", "--color-foreground": "#000" },
      dark: { "--color-background": "#000000", "--color-foreground": "#fff" },
    });
  });

  it("ignores comments and fails when a block is missing", () => {
    expect(() => parseThemeModes("/* @variant light { --x: 1; } */ @theme {}")).toThrow(
      /@variant light/,
    );
  });
});

describe("parseThemeModes", () => {
  it("reads blocks with nested braces", () => {
    const css =
      "@theme { --a: #000; } @variant light { :root { --b: #fff; } } @variant dark { --b: #111; }";

    expect(parseThemeModes(css)).toEqual({
      defaults: { "--a": "#000" },
      light: { "--b": "#fff" },
      dark: { "--b": "#111" },
    });
  });

  it("refuses a theme with a missing or unclosed block", () => {
    expect(() => parseThemeModes("@variant light { } @variant dark { }")).toThrow(
      "The theme has no @theme { block.",
    );
    expect(() => parseThemeModes("@theme { --a: #000;")).toThrow(
      "The theme has an unclosed block.",
    );
  });
});
