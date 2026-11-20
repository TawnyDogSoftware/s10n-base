// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const eas = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../eas.json"), "utf8"),
) as {
  build: Record<string, { extends?: string; env?: { APP_VARIANT?: string }; channel?: string }>;
};

/** A profile's settings with the ones it extends. */
function resolved(name: string): { env?: { APP_VARIANT?: string }; channel?: string } {
  const profile = eas.build[name];
  if (profile === undefined) throw new Error(`No profile ${name}`);
  return profile.extends === undefined ? profile : { ...resolved(profile.extends), ...profile };
}

describe("eas.json", () => {
  it.each([
    ["development", "development"],
    ["development-simulator", "development"],
    ["preview", "preview"],
    ["production", "production"],
  ])("builds the %s profile as the %s variant", (profile, variant) => {
    expect(resolved(profile).env?.APP_VARIANT).toBe(variant);
  });

  it("has no update channels, since over-the-air updates are not set up", () => {
    for (const name of Object.keys(eas.build)) expect(resolved(name).channel).toBeUndefined();
  });
});
