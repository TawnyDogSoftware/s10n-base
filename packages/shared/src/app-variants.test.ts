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

  it("uses placeholders under com.example until a project renames them", () => {
    for (const variant of APP_VARIANTS) {
      expect(appVariants[variant].bundleIdentifier.startsWith("com.example.")).toBe(true);
    }
  });
});
