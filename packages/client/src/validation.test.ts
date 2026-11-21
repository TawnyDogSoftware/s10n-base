import { describe, expect, it } from "vitest";

import { createTranslator } from "@s10n-base/i18n";

import {
  fieldErrorText,
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasskeyName,
  validatePassword,
} from "./validation";

describe("validateName", () => {
  it("trims, and uses the contract's limits", () => {
    expect(validateName("  Sam ")).toEqual({ ok: true, value: "Sam" });
    expect(validateName("   ")).toEqual({ ok: false, error: { key: "validation.nameRequired" } });
    expect(validateName("x".repeat(101))).toEqual({
      ok: false,
      error: { key: "validation.nameTooLong", values: { max: 100 } },
    });
  });

  it("names a character that cannot be used, by its code point", () => {
    const checked = validateName("Sam\u0000");
    expect(checked).toEqual({
      ok: false,
      error: { key: "validation.nameInvalid", values: { character: "U+0000" } },
    });
    // A name that is too long as well is reported as too long first.
    expect(validateName(`${"x".repeat(101)}\u0000`)).toEqual({
      ok: false,
      error: { key: "validation.nameTooLong", values: { max: 100 } },
    });
  });
});

describe("validatePasskeyName", () => {
  it("follows the display-name rule, with its own message for an empty name", () => {
    expect(validatePasskeyName("  Work laptop ")).toEqual({ ok: true, value: "Work laptop" });
    expect(validatePasskeyName("   ")).toEqual({
      ok: false,
      error: { key: "validation.passkeyNameRequired" },
    });
    expect(validatePasskeyName("x".repeat(101))).toEqual({
      ok: false,
      error: { key: "validation.nameTooLong", values: { max: 100 } },
    });
    expect(validatePasskeyName("Lap\u0000top")).toEqual({
      ok: false,
      error: { key: "validation.nameInvalid", values: { character: "U+0000" } },
    });
  });
});

describe("fieldErrorText", () => {
  const t = createTranslator("auth");

  it("gives the text of each kind of error, with its values", () => {
    expect(fieldErrorText(t, { key: "validation.nameRequired" })).toBe("Enter your name.");
    expect(fieldErrorText(t, { key: "validation.passkeyNameRequired" })).toBe(
      "Enter a name for the passkey.",
    );
    expect(fieldErrorText(t, { key: "validation.nameTooLong", values: { max: 100 } })).toBe(
      "Use at most 100 characters.",
    );
    expect(fieldErrorText(t, { key: "validation.passwordTooShort", values: { min: 8 } })).toBe(
      "Use at least 8 characters.",
    );
    expect(
      fieldErrorText(t, { key: "validation.nameInvalid", values: { character: "U+0000" } }),
    ).toBe("The name contains a character that cannot be used: U+0000. Please try another name.");
  });
});

describe("validateEmail", () => {
  it.each(["a@example.com", " a.b+c@sub.example.org "])("accepts %j, trimmed", (value) => {
    expect(validateEmail(value)).toEqual({ ok: true, value: value.trim() });
  });

  it("asks for an address when empty, and a real one when malformed", () => {
    expect(validateEmail("")).toEqual({ ok: false, error: { key: "validation.emailRequired" } });
    for (const value of ["a", "a@", "@b.c", "a b@c.d", "a@b"]) {
      expect(validateEmail(value)).toEqual({
        ok: false,
        error: { key: "validation.emailInvalid" },
      });
    }
  });
});

describe("passwords", () => {
  it("only requires a current password to be present, and keeps it as typed", () => {
    expect(validatePassword(" x ")).toEqual({ ok: true, value: " x " });
    expect(validatePassword("")).toEqual({
      ok: false,
      error: { key: "validation.passwordRequired" },
    });
  });

  it("holds a new password to Better Auth's default length limits", () => {
    expect([PASSWORD_MIN, PASSWORD_MAX]).toEqual([8, 128]);
    expect(validateNewPassword("x".repeat(8))).toEqual({ ok: true, value: "x".repeat(8) });
    expect(validateNewPassword("x".repeat(7))).toEqual({
      ok: false,
      error: { key: "validation.passwordTooShort", values: { min: 8 } },
    });
    expect(validateNewPassword("x".repeat(129))).toEqual({
      ok: false,
      error: { key: "validation.passwordTooLong", values: { max: 128 } },
    });
    expect(validateNewPassword("")).toEqual({
      ok: false,
      error: { key: "validation.passwordRequired" },
    });
  });
});
