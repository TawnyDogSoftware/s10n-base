/**
 * Bare origins: what every place that takes an API or app address accepts. This file imports
 * nothing, like `app-variants.ts`, so the configs that Node loads without a bundler (Vite's and
 * Expo's) can import it as well as the apps and the server.
 */

/**
 * How a bare origin is written: `http://` or `https://`, then a host and port with no slash,
 * backslash, `?`, `#`, `@` or space, then at most one slash. The URL parser forgives spellings
 * this refuses (`https:host`, `https://@host`, `https://host/a/..`), which name a bare origin
 * only after normalising.
 */
const BARE_ORIGIN_SPELLING = /^https?:\/\/[^/\\?#@\s]+\/?$/i;

/**
 * `value` as a URL when it is a bare http or https origin: a scheme, a host and an optional port,
 * and nothing else, as written. A trailing slash is allowed, since `new URL` adds one anyway; a
 * path (even one that normalises away), a query, a fragment (even an empty `?` or `#`) and
 * credentials are not. Null otherwise.
 */
export function parseBareOrigin(value: string): URL | null {
  if (!BARE_ORIGIN_SPELLING.test(value)) return null;
  // The spelling leaves no room for a path, query, fragment or credentials; the parser checks
  // the host and the port.
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
