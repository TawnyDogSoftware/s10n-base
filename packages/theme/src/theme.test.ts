import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contrastRatio, parseThemeModes } from "./contrast";

const css = readFileSync(new URL("../theme.css", import.meta.url), "utf8");
const { defaults, light, dark } = parseThemeModes(css);

/** Text needs 4.5:1 (WCAG 1.4.3); borders that identify a control need 3:1 (WCAG 1.4.11). */
const TEXT = 4.5;
const NON_TEXT = 3;

/** Every foreground and background pair the components use together. */
const PAIRS = [
  ["foreground", "background", TEXT, "body text"],
  ["muted", "background", TEXT, "secondary text"],
  ["primary", "background", TEXT, "links"],
  ["primary-foreground", "primary", TEXT, "primary button label"],
  ["danger", "background", TEXT, "error text"],
  ["success", "background", TEXT, "success text"],
  ["border", "background", NON_TEXT, "input and card borders"],
  ["primary", "background", NON_TEXT, "focus ring"],
] as const;

const COLOURS = [
  "background",
  "foreground",
  "muted",
  "border",
  "primary",
  "primary-foreground",
  "danger",
  "success",
];

describe("theme.css", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("defines every semantic colour in %s mode, and nothing else", (_mode, values) => {
    expect(Object.keys(values).toSorted()).toEqual(
      COLOURS.map((name) => `--color-${name}`).toSorted(),
    );
  });

  it("defaults each colour to its light value, so utilities exist before a mode applies", () => {
    for (const name of COLOURS) {
      expect(defaults[`--color-${name}`], name).toBe(light[`--color-${name}`]);
    }
  });

  it("defines radii and the font stack once, for both modes", () => {
    expect(Object.keys(defaults).filter((key) => key.startsWith("--radius-"))).not.toEqual([]);
    expect(defaults["--font-sans"]).toEqual(expect.any(String));
  });

  it("clears Tailwind's default palette, so only these colours can be used", () => {
    expect(defaults["--color-*"]).toBe("initial");
  });

  describe.each([
    ["light", light],
    ["dark", dark],
  ] as const)("in %s mode", (_mode, values) => {
    it.each(PAIRS)("%s on %s reaches %s:1 (%s)", (foreground, background, minimum) => {
      const ratio = contrastRatio(
        values[`--color-${foreground}`] ?? "",
        values[`--color-${background}`] ?? "",
      );
      expect(ratio).toBeGreaterThanOrEqual(minimum);
    });
  });
});
