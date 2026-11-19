import { authEmailText } from "./text";

/**
 * How long a verification or password reset link works, in seconds. Better Auth is given this
 * expiry, and the email text says "one hour".
 */
export const AUTH_EMAIL_LINK_SECONDS = 60 * 60;

export type AuthEmailKind = "verifyEmail" | "resetPassword";

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface RenderOptions {
  readonly supportEmail: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Renders an auth email around its one link, as plain text and HTML. Every value placed in the
 * HTML is escaped.
 *
 * @throws {Error} when `url` is not an absolute http or https URL, since it goes into an `href`.
 */
export function renderAuthEmail(
  kind: AuthEmailKind,
  url: string,
  options: RenderOptions,
): RenderedEmail {
  const parsed = URL.parse(url);
  if (parsed === null || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    throw new Error("An auth email link must be an absolute http or https URL.");
  }
  const { subject, heading, body, action } = authEmailText[kind];
  const link = parsed.href;
  const footer = authEmailText.footer(options.supportEmail);
  const href = escapeHtml(link);
  return {
    subject,
    text: [heading, body, `${action}: ${link}`, authEmailText.ignoreNotice, footer].join("\n\n"),
    html: [
      "<!doctype html>",
      '<html><body style="font-family: sans-serif; line-height: 1.5">',
      `<h1>${escapeHtml(heading)}</h1>`,
      `<p>${escapeHtml(body)}</p>`,
      `<p><a href="${href}">${escapeHtml(action)}</a></p>`,
      `<p>${escapeHtml(authEmailText.linkFallback)}<br>${href}</p>`,
      `<p>${escapeHtml(authEmailText.ignoreNotice)}</p>`,
      `<p>${escapeHtml(footer)}</p>`,
      "</body></html>",
    ].join("\n"),
  };
}
