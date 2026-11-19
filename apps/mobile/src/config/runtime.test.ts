import { describe, expect, it } from "vitest";

import { readAppExtra } from "./runtime";

describe("readAppExtra", () => {
  it("reads what the Expo config put in extra", () => {
    expect(
      readAppExtra({
        extra: { appVariant: "preview", apiBaseUrl: "https://api.example.com", router: {} },
      }),
    ).toEqual({ appVariant: "preview", apiBaseUrl: "https://api.example.com" });
  });

  it.each([
    ["no config at all", null],
    ["no extra", {}],
    ["an unknown variant", { extra: { appVariant: "staging", apiBaseUrl: "https://a.example" } }],
    ["no API origin", { extra: { appVariant: "development" } }],
    ["an API URL that is not a bare origin", { extra: { appVariant: "development", apiBaseUrl: "https://a.example/api" } }],
  ])("refuses a build with %s", (_case, expoConfig) => {
    expect(() => readAppExtra(expoConfig)).toThrow("This build's configuration is invalid");
  });
});
