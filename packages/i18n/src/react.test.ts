import { describe, expect, it } from "vitest";

import { createReactI18n } from "./react";

describe("createReactI18n", () => {
  it("is ready on return, in English for an unsupported language", () => {
    const i18n = createReactI18n(["fr-FR"]);

    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe("en");
    expect(i18n.t("signIn.title", { ns: "auth" })).toBe("Sign in");
    expect(i18n.t("appName")).toBe("S10N Base");
  });
});
