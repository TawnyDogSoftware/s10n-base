import { describe, expect, it, vi } from "vitest";

import { checkFields } from "./form";
import { validateEmail, validateName } from "./validation";

function field() {
  const focus = vi.fn<() => void>();
  return { ref: { current: { focus } }, focus };
}

describe("checkFields", () => {
  it("returns every value when all fields pass, and moves no focus", () => {
    const name = field();
    const email = field();

    expect(
      checkFields([
        ["name", validateName(" Sam "), name.ref],
        ["email", validateEmail("sam@example.com"), email.ref],
      ]),
    ).toEqual({ ok: true, values: { name: "Sam", email: "sam@example.com" } });
    expect(name.focus).not.toHaveBeenCalled();
  });

  it("returns each error and focuses the first invalid field", () => {
    const name = field();
    const email = field();

    expect(
      checkFields([
        ["name", validateName("Sam"), name.ref],
        ["email", validateEmail(""), email.ref],
      ]),
    ).toEqual({ ok: false, errors: { email: { key: "validation.emailRequired" } } });
    expect(email.focus).toHaveBeenCalledOnce();
    expect(name.focus).not.toHaveBeenCalled();
  });

  it("still reports the errors when the field is not mounted", () => {
    expect(checkFields([["email", validateEmail(""), { current: null }]])).toEqual({
      ok: false,
      errors: { email: { key: "validation.emailRequired" } },
    });
  });
});
