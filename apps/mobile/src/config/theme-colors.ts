/**
 * The colours native code needs before any CSS runs: the splash screen's and Android's icon
 * background. They come from `packages/theme/theme.css`, read when Expo loads the config, so the
 * theme file stays the only place a colour is written.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { parseThemeModes } from "@s10n-base/theme/tokens";

export interface NativeColors {
  readonly light: { readonly background: string };
  readonly dark: { readonly background: string };
}

/** The background of each mode in a theme file's source. */
export function nativeColors(css: string): NativeColors {
  const modes = parseThemeModes(css);
  const background = (mode: "light" | "dark") => {
    const value = modes[mode]["--color-background"];
    if (value === undefined) throw new Error(`The theme has no --color-background in ${mode} mode.`);
    return value;
  };
  return { light: { background: background("light") }, dark: { background: background("dark") } };
}

/** Reads the theme package's file, found the way Node resolves the package. */
export function readNativeColors(): NativeColors {
  const file = createRequire(import.meta.url).resolve("@s10n-base/theme/theme.css");
  return nativeColors(readFileSync(file, "utf8"));
}
