/**
 * Field validation for the forms. The name rule is the contract's (`ProfileName`), so the client
 * and server agree; the password limits are Better Auth's defaults, which the server uses.
 */
import { Schema } from "effect";
import type { TFunction } from "i18next";

import { PROFILE_NAME_FORBIDDEN, PROFILE_NAME_MAX, ProfileName } from "@s10n-base/contracts";

/** Better Auth's default `minPasswordLength` and `maxPasswordLength`. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** A message in the `auth` namespace, with the values it interpolates. */
export type FieldError =
  | {
      readonly key:
        | "validation.nameRequired"
        | "validation.emailRequired"
        | "validation.emailInvalid"
        | "validation.passwordRequired";
    }
  | {
      readonly key: "validation.nameTooLong" | "validation.passwordTooLong";
      readonly values: { readonly max: number };
    }
  | { readonly key: "validation.passwordTooShort"; readonly values: { readonly min: number } }
  | {
      readonly key: "validation.nameInvalid";
      /** The character the name may not hold, as its code point: `U+0000`. */
      readonly values: { readonly character: string };
    };

/** The text of a field error. */
export function fieldErrorText(t: TFunction<"auth">, error: FieldError): string {
  switch (error.key) {
    case "validation.nameTooLong":
    case "validation.passwordTooLong":
      return t(error.key, { max: error.values.max });
    case "validation.passwordTooShort":
      return t(error.key, { min: error.values.min });
    case "validation.nameInvalid":
      return t(error.key, { character: error.values.character });
    default:
      return t(error.key);
  }
}

export type Validated =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: FieldError };

const fail = (error: FieldError): Validated => ({ ok: false, error });

const decodeName = Schema.decodeUnknownExit(ProfileName);

/**
 * The first character of `name` that a name may not hold, as `U+` and its code in upper-case
 * hexadecimal, at least four digits. The rule refuses only a character that cannot be seen, so
 * there is no branch that shows a visible one; a project that forbids visible characters adds it
 * with its rule. The pattern matches one UTF-16 unit, which `charCodeAt` reads whole.
 */
function forbiddenCharacter(name: string): string {
  const code = name.charCodeAt(name.search(PROFILE_NAME_FORBIDDEN));
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * The contract decides whether a name is valid. The length test and the search for a forbidden
 * character only choose the message for one it refuses.
 */
export function validateName(input: string): Validated {
  const trimmed = input.trim();
  if (trimmed === "") return fail({ key: "validation.nameRequired" });
  if (trimmed.length > PROFILE_NAME_MAX)
    return fail({ key: "validation.nameTooLong", values: { max: PROFILE_NAME_MAX } });
  const decoded = decodeName(input);
  return decoded._tag === "Success"
    ? { ok: true, value: decoded.value }
    : fail({ key: "validation.nameInvalid", values: { character: forbiddenCharacter(trimmed) } });
}

/** Something, `@`, a domain with a dot, and no spaces. The server has the final say. */
// The domain is dot-separated labels, so no two parts of the pattern can match the same text.
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function validateEmail(input: string): Validated {
  const trimmed = input.trim();
  if (trimmed === "") return fail({ key: "validation.emailRequired" });
  return EMAIL.test(trimmed)
    ? { ok: true, value: trimmed }
    : fail({ key: "validation.emailInvalid" });
}

/** A password for signing in: present. Never trimmed. */
export function validatePassword(input: string): Validated {
  return input === "" ? fail({ key: "validation.passwordRequired" }) : { ok: true, value: input };
}

/** A new password: within Better Auth's length limits. Never trimmed. */
export function validateNewPassword(input: string): Validated {
  if (input === "") return fail({ key: "validation.passwordRequired" });
  if (input.length < PASSWORD_MIN)
    return fail({ key: "validation.passwordTooShort", values: { min: PASSWORD_MIN } });
  if (input.length > PASSWORD_MAX)
    return fail({ key: "validation.passwordTooLong", values: { max: PASSWORD_MAX } });
  return { ok: true, value: input };
}
