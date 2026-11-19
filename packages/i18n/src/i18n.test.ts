import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@s10n-base/contracts";

import {
  AUTH_ERROR_CODES,
  DEFAULT_LOCALE,
  appErrorKey,
  authErrorKey,
  createTranslator,
  NAMESPACES,
  resolveLocale,
  resources,
} from "./index";

function keys(catalog: object, prefix = ""): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("catalogs", () => {
  it("have English as the only locale and the default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(Object.keys(resources)).toEqual(["en"]);
  });

  it("have the six namespaces", () => {
    expect(NAMESPACES).toEqual(["common", "auth", "profile", "admin", "errors", "email"]);
    expect(Object.keys(resources.en).toSorted()).toEqual([...NAMESPACES].toSorted());
  });

  it("give every locale exactly the keys English has", () => {
    const english = keys(resources.en).toSorted();
    for (const catalog of Object.values(resources)) {
      expect(keys(catalog).toSorted()).toEqual(english);
    }
  });

  it("have no empty message", () => {
    for (const catalog of Object.values(resources)) {
      for (const key of keys(catalog)) {
        const value = key
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog);
        expect(value, key).toEqual(expect.stringMatching(/\S/));
      }
    }
  });
});

describe("createTranslator", () => {
  it("translates synchronously, without an await", () => {
    const t = createTranslator("email");

    expect(t("verifyEmail.subject")).toBe("Confirm your email address");
  });

  it("interpolates without HTML-escaping, since the email renderer escapes", () => {
    const t = createTranslator("email", "en");

    expect(t("footer", { supportEmail: "<help@example.com>" })).toBe(
      "Questions? Write to <help@example.com>.",
    );
  });
});

describe("resolveLocale", () => {
  it("picks the first supported language, by its language subtag, and falls back to English", () => {
    expect(resolveLocale(["en"])).toBe("en");
    expect(resolveLocale(["en-GB"])).toBe("en");
    expect(resolveLocale(["de-DE", "EN-us"])).toBe("en");
    expect(resolveLocale(["de"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
    expect(resolveLocale(["", "toString", "__proto__"])).toBe("en");
  });
});

describe("error messages", () => {
  const t = createTranslator("errors");

  it("has a message for every error code in the contracts", () => {
    for (const code of Object.values(ERROR_CODES)) {
      const key = appErrorKey(code);
      expect(key, code).toBe(code);
      expect(t(key)).not.toBe(t("generic"));
    }
  });

  it("has a message for every Better Auth error code the screens handle", () => {
    for (const code of AUTH_ERROR_CODES) {
      const key = authErrorKey(code);
      expect(key, code).toBe(`betterAuth.${code}`);
      expect(t(key)).not.toBe(t("generic"));
    }
  });

  it("falls back to the generic message for an unknown code", () => {
    expect(appErrorKey("made.up")).toBe("generic");
    expect(appErrorKey("auth")).toBe("generic");
    expect(appErrorKey("__proto__.constructor")).toBe("generic");
    expect(authErrorKey("NOT_A_CODE")).toBe("generic");
    expect(authErrorKey("constructor")).toBe("generic");
    expect(t(appErrorKey("made.up"))).toBe("Something went wrong. Try again.");
  });
});
