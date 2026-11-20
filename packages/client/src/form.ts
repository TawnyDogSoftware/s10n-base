/**
 * Checking a form's fields together, on the web and on mobile.
 */
import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { FieldError, Validated } from "./validation";

/** What a field's ref must offer: an `<input>` on the web, a `TextInput` on mobile. */
export interface Focusable {
  readonly focus: () => void;
}

/** Field errors by field name; a field with no entry is valid. */
export type FieldErrors<Name extends string> = Partial<Record<Name, FieldError>>;

/**
 * Validates every field, in order. Returns the values when all pass; otherwise the errors and the
 * first invalid field, to focus once its error is on screen ({@link useFocusAfterRender}).
 */
export function checkFields<Name extends string>(
  fields: ReadonlyArray<readonly [Name, Validated, RefObject<Focusable | null>]>,
):
  | { readonly ok: true; readonly values: Record<Name, string> }
  | {
      readonly ok: false;
      readonly errors: FieldErrors<Name>;
      readonly first: RefObject<Focusable | null>;
    } {
  const errors: FieldErrors<Name> = {};
  const values = {} as Record<Name, string>;
  let first: RefObject<Focusable | null> | null = null;
  for (const [name, result, ref] of fields) {
    if (result.ok) {
      values[name] = result.value;
    } else {
      errors[name] = result.error;
      first ??= ref;
    }
  }
  if (first === null) return { ok: true, values };
  return { ok: false, errors, first };
}

/** `errors` without `name`'s: for a field whose value changed since it was checked. */
export function withoutError<Name extends string>(
  errors: FieldErrors<Name>,
  name: Name,
): FieldErrors<Name> {
  if (!(name in errors)) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => field !== name),
  ) as FieldErrors<Name>;
}

/**
 * Returns a function that focuses a field after the next render, so the error that render shows
 * is already there, and named by the field, when a screen reader reads the field out. Focusing
 * in the same tick as setting the error would read the field without it.
 */
export function useFocusAfterRender(): (ref: RefObject<Focusable | null>) => void {
  const target = useRef<RefObject<Focusable | null> | null>(null);
  useEffect(() => {
    const ref = target.current;
    target.current = null;
    ref?.current?.focus();
  });
  return useCallback((ref) => {
    target.current = ref;
  }, []);
}
