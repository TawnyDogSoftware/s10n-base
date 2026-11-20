import { describe, expect, it } from "vitest";

import { APP_VARIANTS, appVariants } from "./app-variants";

describe("appVariants", () => {
  it("describes development, preview and production", () => {
    expect(APP_VARIANTS).toEqual(["development", "preview", "production"]);
    expect(Object.keys(appVariants).toSorted((left, right) => left.localeCompare(right))).toEqual(
      [...APP_VARIANTS].toSorted((left, right) => left.localeCompare(right)),
    );
  });

  it("gives each variant its own valid URL scheme and display name", () => {
    const schemes = APP_VARIANTS.map((variant) => appVariants[variant].urlScheme);
    const names = APP_VARIANTS.map((variant) => appVariants[variant].displayName);

    // RFC 3986: a letter, then letters, digits, "+", "-" or ".". Lower case, as iOS expects.
    for (const scheme of schemes) expect(scheme).toMatch(/^[a-z][a-z0-9+.-]*$/);
    expect(new Set(schemes).size).toBe(schemes.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives each variant its own bundle identifier, valid on iOS and Android", () => {
    const ids = APP_VARIANTS.map((variant) => appVariants[variant].bundleIdentifier);

    // Android's rule is the stricter one: at least two dot-separated segments, each a letter
    // followed by letters, digits or underscores. iOS also allows "-", Android does not.
    for (const id of ids) expect(id).toMatch(/^[a-z]\w*(\.[a-z]\w*)+$/i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the development and preview builds after the production one", () => {
    const { development, preview, production } = appVariants;

    // `bun run rename` replaces the names, so this holds before and after it.
    expect(development.bundleIdentifier).toBe(`${production.bundleIdentifier}.dev`);
    expect(preview.bundleIdentifier).toBe(`${production.bundleIdentifier}.preview`);
    expect(development.urlScheme).toBe(`${production.urlScheme}-dev`);
    expect(preview.urlScheme).toBe(`${production.urlScheme}-preview`);
    expect(development.displayName).toBe(`${production.displayName} (Dev)`);
    expect(preview.displayName).toBe(`${production.displayName} (Preview)`);
  });
});
