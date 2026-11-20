import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { checkFields, useFocusAfterRender, withoutError } from "./form";
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

  it("returns each error and the first invalid field, and moves no focus itself", () => {
    const name = field();
    const email = field();
    const other = field();

    expect(
      checkFields([
        ["name", validateName("Sam"), name.ref],
        ["email", validateEmail(""), email.ref],
        ["other", validateName(""), other.ref],
      ]),
    ).toEqual({
      ok: false,
      errors: {
        email: { key: "validation.emailRequired" },
        other: { key: "validation.nameRequired" },
      },
      first: email.ref,
    });
    expect(email.focus).not.toHaveBeenCalled();
  });
});

describe("useFocusAfterRender", () => {
  it("focuses the field after the next render, once", () => {
    const email = field();
    const { result, rerender } = renderHook(() => useFocusAfterRender());

    result.current(email.ref);
    expect(email.focus).not.toHaveBeenCalled();
    rerender();
    expect(email.focus).toHaveBeenCalledOnce();
    rerender();
    expect(email.focus).toHaveBeenCalledOnce();
  });
});

describe("withoutError", () => {
  it("drops one field's error, and keeps the same object when it had none", () => {
    const errors = { email: { key: "validation.emailRequired" as const } };

    expect(withoutError<"email" | "password">(errors, "email")).toEqual({});
    expect(withoutError<"email" | "password">(errors, "password")).toBe(errors);
  });
});
