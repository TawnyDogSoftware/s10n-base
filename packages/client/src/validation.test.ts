import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateEmail,
  validateName,
  validateNewPassword,
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
