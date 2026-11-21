/**
 * The prefix of every auth cookie (`s10n-base.session_token`). The server sets it and the mobile
 * app's auth client reads cookies by it, so it lives here, where both import it. A project renames
 * it in this one place.
 *
 * This file imports nothing, like `app-variants.ts`.
 */
export const AUTH_COOKIE_PREFIX = "s10n-base";
