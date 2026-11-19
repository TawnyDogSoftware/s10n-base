import { describe, expect, it } from "vitest";

import { APP_VARIANTS, appVariants } from "./app-variants";

describe("appVariants", () => {
  it("describes development, preview and production", () => {
    expect(APP_VARIANTS).toEqual(["development", "preview", "production"]);
    expect(Object.keys(appVariants).sort()).toEqual([...APP_VARIANTS].sort());
  });

  it("gives each variant its own valid URL scheme and display name", () => {
    const schemes = APP_VARIANTS.map((variant) => appVariants[variant].urlScheme);
    const names = APP_VARIANTS.map((variant) => appVariants[variant].displayName);

    // RFC 3986: a letter, then letters, digits, "+", "-" or ".". Lower case, as iOS expects.
    for (const scheme of schemes) expect(scheme).toMatch(/^[a-z][a-z0-9+.-]*$/);
    expect(new Set(schemes).size).toBe(schemes.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
