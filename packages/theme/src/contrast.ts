/**
 * WCAG 2 contrast, computed from the token values themselves, and a small reader for the theme
 * file's blocks. Used by the contrast test, and by the mobile app's Expo config for the colours
 * native code needs before any CSS runs (the splash screen and Android's icon background).
 *
 * This file imports nothing, so Node can load it from the Expo config as it is.
 */

export type Rgb = readonly [number, number, number];

/** Reads `#rgb` or `#rrggbb`. Theme colours are hex so the test can compute contrast exactly. */
export function parseHexColor(value: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match?.[1] === undefined) throw new Error(`Not a hex colour: ${value}`);
  const hex =
    match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return [0, 2, 4].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as unknown as Rgb;
}

/** WCAG 2 relative luminance of an sRGB colour. */
export function relativeLuminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2 contrast ratio between two hex colours, from 1 to 21, in either order. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [
    relativeLuminance(parseHexColor(first)),
    relativeLuminance(parseHexColor(second)),
  ].sort((left, right) => right - left) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export type Declarations = Readonly<Record<string, string>>;

export interface ThemeModes {
  /** The `@theme` block: what Tailwind's utilities are built from. */
  readonly defaults: Declarations;
  readonly light: Declarations;
  readonly dark: Declarations;
}

/** The body of the first block that opens with `opener`, braces matched. */
function blockBody(css: string, opener: RegExp): string {
  const match = opener.exec(css);
  if (match === null)
    throw new Error(`The theme has no ${opener.source.replaceAll("\\s*", " ")} block.`);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, index);
  }
  throw new Error("The theme has an unclosed block.");
}

function declarations(body: string): Declarations {
  const values: Record<string, string> = {};
  for (const [, name = "", value = ""] of body.matchAll(/(--[\w*-]+)\s*:\s*([^;{}]+);/g)) {
    values[name] = value.trim();
  }
  return values;
}

/** Reads the `@theme` block and the `@variant light` and `@variant dark` blocks. */
export function parseThemeModes(source: string): ThemeModes {
  const css = source.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return {
    defaults: declarations(blockBody(css, /@theme\s*\{/)),
    light: declarations(blockBody(css, /@variant light\s*\{/)),
    dark: declarations(blockBody(css, /@variant dark\s*\{/)),
  };
}
