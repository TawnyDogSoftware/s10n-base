/**
 * Bare origins: what every place that takes an API or app address accepts. This file imports
 * nothing, like `app-variants.ts`, so the configs that Node loads without a bundler (Vite's and
 * Expo's) can import it as well as the apps and the server.
 */

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * `value` as a URL when it is a bare http or https origin: a scheme, a host and an optional port,
 * and nothing else. A trailing slash is allowed, since `new URL` adds one anyway; a path, a query,
 * a fragment (even an empty `?` or `#`) and credentials are not. Null otherwise.
 */
export function parseBareOrigin(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `href` is the origin plus "/" exactly when nothing follows the host and port.
  return HTTP_PROTOCOLS.has(url.protocol) && url.href === `${url.origin}/` ? url : null;
}
