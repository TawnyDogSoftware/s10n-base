/**
 * What a running build knows about itself: the values `app.config.ts` put in
 * `Constants.expoConfig.extra`. A build without them is broken, so reading them throws instead
 * of guessing.
 */
import { Schema } from "effect";

import { parseBaseUrl } from "@s10n-base/client/rpc";
import { APP_VARIANTS } from "@s10n-base/shared/app-variants";

import type { AppExtra } from "./expo-config.ts";

const Extra = Schema.Struct({
  appVariant: Schema.Literals(APP_VARIANTS),
  apiBaseUrl: Schema.String,
});
const decodeExtra = Schema.decodeUnknownExit(Extra);

export function readAppExtra(
  expoConfig: { readonly extra?: unknown } | null | undefined,
): AppExtra {
  const decoded = decodeExtra(expoConfig?.extra);
  if (decoded._tag === "Failure") {
    throw new Error("This build's configuration is invalid: rebuild it with app.config.ts.");
  }
  const { appVariant, apiBaseUrl } = decoded.value;
  let origin: string;
  try {
    origin = parseBaseUrl(apiBaseUrl);
  } catch (cause) {
    throw new Error("This build's configuration is invalid: rebuild it with app.config.ts.", {
      cause,
    });
  }
  return { appVariant, apiBaseUrl: origin };
}
