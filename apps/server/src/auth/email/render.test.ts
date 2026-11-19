import { describe, expect, it } from "vitest";

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
    expect(AUTH_EMAIL_LINK_SECONDS).toBe(60 * 60);
    expect(renderAuthEmail("verifyEmail", "https://x.example/", { supportEmail }).text).toContain(
      "one hour",
    );
    expect(renderAuthEmail("resetPassword", "https://x.example/", { supportEmail }).text).toContain(
      "one hour",
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
