/**
 * The `errors` message for any failure a screen can show, on the web and on mobile.
 */
import { appErrorKey, authErrorKey, type ErrorMessageKey } from "@s10n-base/i18n";

import type { AuthFailure } from "./auth";
import { NetworkError, RpcError } from "./transport";

function isAuthFailure(value: unknown): value is AuthFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/** The `errors` message for a refusal from Better Auth or a thrown error. */
export function errorMessageKey(failure: unknown): ErrorMessageKey {
  if (isAuthFailure(failure)) {
    return failure.code === "RATE_LIMITED" ? "rateLimited" : authErrorKey(failure.code);
  }
  if (failure instanceof RpcError) return appErrorKey(failure.code);
  if (failure instanceof NetworkError) return "network";
  return "generic";
}
