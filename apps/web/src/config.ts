/**
 * The web app's build-time settings. Vite exposes `VITE_*` variables as `import.meta.env`;
 * `vite.config.ts` calls {@link readApiBaseUrl} too, so a malformed value fails the build rather
 * than the page. Vite loads the config through Node, which can load a workspace file only if it
 * imports nothing itself, so this file imports only `@s10n-base/shared/origin`, which does not.
 */
import { parseBareOrigin } from "@s10n-base/shared/origin";

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
  const url = parseBareOrigin(value);
  if (url === null) {
    throw new Error(`VITE_API_BASE_URL must be a bare http(s) origin; got "${value}".`);
  }
  return url.origin;
}
