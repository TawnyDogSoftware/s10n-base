/**
 * CORS for one allowed origin, `APP_URL`'s. That origin gets its own value echoed back with
 * credentials allowed (never `*`). Any other origin gets no CORS headers, so the browser keeps
 * the response from the page, and its preflight is refused. Requests with no `Origin` (same
 * origin, mobile apps, curl) are not affected.
 */
const ALLOWED_METHODS = "GET, POST";
const ALLOWED_HEADERS = "content-type";
const PREFLIGHT_MAX_AGE_SECONDS = "600";

export type CorsDecision =
  | "no-origin"
  | "allowed"
  | "denied"
  | "preflight-allowed"
  | "preflight-denied";

interface CorsRequest {
  readonly method?: string | undefined;
  readonly headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>;
}

interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

export function applyCors(
  request: CorsRequest,
  response: HeaderSink,
  allowedOrigin: string,
): CorsDecision {
  // The answer depends on Origin, so caches must not reuse it for another origin.
  response.setHeader("Vary", "Origin");
  const origin = request.headers.origin;
  const preflight =
    request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined;
  if (origin === undefined) return "no-origin";
  if (origin !== allowedOrigin) return preflight ? "preflight-denied" : "denied";

  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  if (!preflight) return "allowed";
  response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
  return "preflight-allowed";
}
