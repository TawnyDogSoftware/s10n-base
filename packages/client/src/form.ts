/**
 * Checking a form's fields together, on the web and on mobile.
 */
import type { RefObject } from "react";

import type { FieldError, Validated } from "./validation";

/** What a field's ref must offer: an `<input>` on the web, a `TextInput` on mobile. */
export interface Focusable {
  readonly focus: () => void;
}

/** Field errors by field name; a field with no entry is valid. */
export type FieldErrors<Name extends string> = Partial<Record<Name, FieldError>>;

/**
 * Validates every field, in order. Returns the values when all pass; otherwise the errors, after
 * moving focus to the first invalid field so its error is read out.
 */
export function checkFields<Name extends string>(
  fields: ReadonlyArray<readonly [Name, Validated, RefObject<Focusable | null>]>,
):
  | { readonly ok: true; readonly values: Record<Name, string> }
  | { readonly ok: false; readonly errors: FieldErrors<Name> } {
  const errors: FieldErrors<Name> = {};
  const values = {} as Record<Name, string>;
  let invalid = false;
  let first: Focusable | null = null;
  for (const [name, result, ref] of fields) {
    if (result.ok) {
      values[name] = result.value;
    } else {
      errors[name] = result.error;
      invalid = true;
      first ??= ref.current;
    }
  }
  if (!invalid) return { ok: true, values };
  first?.focus();
  return { ok: false, errors };
}
