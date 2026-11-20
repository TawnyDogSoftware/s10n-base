interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

/**
 * The Content-Security-Policy for HTML pages. Vite's build has no inline script or style, so
 * everything is same-origin; `data:` images cover small inlined assets.
 */
export const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers every response carries. Strict-Transport-Security only when the app is on https. */
export function applySecurityHeaders(response: HeaderSink, options: { readonly https: boolean }) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (options.https) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
