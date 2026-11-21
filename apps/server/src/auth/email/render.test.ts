import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resources } from "@s10n-base/i18n";

import { AUTH_EMAIL_LINK_SECONDS, renderAuthEmail } from "./render";

const supportEmail = "support@example.com";

describe("renderAuthEmail", () => {
  it.each(["verifyEmail", "resetPassword"] as const)(
    "renders %s with its link in the text and the HTML",
    (kind) => {
      const url = "https://app.example.com/api/auth/verify-email?token=abc&callbackURL=%2F";

      const email = renderAuthEmail(kind, url, { supportEmail });

      expect(email.subject).not.toBe("");
      expect(email.text).toContain(url);
      expect(email.text).toContain(supportEmail);
      expect(email.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
      expect(email.html).toContain(supportEmail);
    },
  );

  it("says how long the link works, matching the expiry Better Auth is given", () => {
    expect(AUTH_EMAIL_LINK_SECONDS).toBe(15 * 60);
    expect(renderAuthEmail("verifyEmail", "https://x.example/", { supportEmail }).text).toContain(
      "15 minutes",
    );
    expect(renderAuthEmail("resetPassword", "https://x.example/", { supportEmail }).text).toContain(
      "15 minutes",
    );
  });

  it("escapes every interpolated value in the HTML", () => {
    const email = renderAuthEmail("verifyEmail", "https://x.example/?a=\"><script>&b='", {
      supportEmail: "<b>support</b>@example.com",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>support</b>");
    expect(email.html).toContain("&lt;b&gt;support&lt;/b&gt;@example.com");
    expect(email.html).not.toMatch(/href="[^"]*"[^>]*"/);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://x.example/",
    "/relative/path",
    "not a url",
  ])("refuses to render a link that is not http or https: %s", (url) => {
    expect(() => renderAuthEmail("resetPassword", url, { supportEmail })).toThrow(/http or https/);
  });
});

/** Every string in a catalog, however deeply nested. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(strings);
}

/** The lifetimes a text states, by the wording the copy and the docs share: "work(s) for …". */
function statedLifetimes(text: string): string[] {
  return [...text.matchAll(/works? for ([^.,;(]+)/g)].map((match) => (match[1] ?? "").trim());
}

describe("the link lifetime the copy and the docs state", () => {
  // The words for each lifetime the copy may state. Change AUTH_EMAIL_LINK_SECONDS and these
  // tests fail until the emails, the screens and the docs that mention the lifetime say the new
  // one.
  const PHRASES: Readonly<Record<number, string>> = { 900: "15 minutes" };
  /** The docs that say how long a link works. */
  const DOCS = ["docs/auth.md", "docs/deployment.md", "docs/i18n.md"];
  const root = path.resolve(import.meta.dirname, "../../../../..");

  it("is the lifetime Better Auth is given, in every string that states one", () => {
    const stated = Object.values(resources).flatMap(strings).flatMap(statedLifetimes);

    expect(stated.length).toBeGreaterThanOrEqual(4);
    expect(new Set(stated)).toEqual(new Set([PHRASES[AUTH_EMAIL_LINK_SECONDS]]));
  });

  it.each(DOCS)("is the lifetime %s states", (file) => {
    const stated = statedLifetimes(readFileSync(path.join(root, file), "utf8"));

    expect(stated.length).toBeGreaterThanOrEqual(1);
    expect(new Set(stated)).toEqual(new Set([PHRASES[AUTH_EMAIL_LINK_SECONDS]]));
  });
});
