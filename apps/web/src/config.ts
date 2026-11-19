/**
 * The web app's build-time settings. Vite exposes `VITE_*` variables as `import.meta.env`;
 * `vite.config.ts` calls {@link readApiBaseUrl} too, so a malformed value fails the build rather
 * than the page. This file imports nothing: Vite loads the config through Node, which cannot load
 * the workspace packages' TypeScript source.
 */

export interface WebEnv {
  readonly VITE_API_BASE_URL?: string | undefined;
}

/**
 * The API origin the RPC and auth clients call: `VITE_API_BASE_URL`, or the page's own origin
 * when it is unset (the server serves the web app, or Vite proxies the API in development).
 *
 * @throws {Error} when it is set to anything but a bare http(s) origin.
 */
export function readApiBaseUrl(env: WebEnv, pageOrigin: string): string {
  const value = env.VITE_API_BASE_URL?.trim() ?? "";
  if (value === "") return pageOrigin;
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (
    url === undefined ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`VITE_API_BASE_URL must be a bare http(s) origin; got "${value}".`);
  }
  return url.origin;
}
