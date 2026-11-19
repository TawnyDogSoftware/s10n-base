import type { RefObject } from "react";

import type { FieldError, Validated } from "./validation";

/** Field errors by field name; a field with no entry is valid. */
export type FieldErrors<Name extends string> = Partial<Record<Name, FieldError>>;

/**
 * Validates every field, in order. Returns the values when all pass; otherwise the errors, after
 * moving focus to the first invalid field so its error is read out.
 */
export function checkFields<Name extends string>(
  fields: ReadonlyArray<readonly [Name, Validated, RefObject<HTMLInputElement | null>]>,
):
  | { readonly ok: true; readonly values: Record<Name, string> }
  | { readonly ok: false; readonly errors: FieldErrors<Name> } {
  const errors: FieldErrors<Name> = {};
  const values = {} as Record<Name, string>;
  let first: HTMLInputElement | null = null;
  for (const [name, result, ref] of fields) {
    if (result.ok) {
      values[name] = result.value;
    } else {
      errors[name] = result.error;
      first ??= ref.current;
    }
  }
  if (first === null) return { ok: true, values };
  first.focus();
  return { ok: false, errors };
}
