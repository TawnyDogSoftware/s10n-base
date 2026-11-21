/**
 * The browser journeys plan 000 and plans 004 to 005 ask for, and the admin user list's. Each runs from its own client
 * address (one trusted proxy hop), so the sign-in rate limit applies to it alone.
 */
import { expect, test } from "@playwright/test";

import {
  expectAccessible,
  freshEmail,
  linkFor,
  makeAdmin,
  signUpAndSignIn,
  signUpUsers,
  watchConsole,
} from "./support";

/** The web app's page size (`apps/web/src/routes/admin-users.tsx`). */
const ADMIN_USERS_PAGE_SIZE = 25;

const PASSWORD = "a long enough passphrase";

test.describe("signing up, confirming the address, signing in and out", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.10" } });

  test("works end to end, with every page accessible and no console error", async ({ page }) => {
    const errors = watchConsole(page);
    const email = freshEmail("journey");

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Create an account" })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel("Name").fill("Robin Example");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    // The result replaces the form, and takes focus.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    await expectAccessible(page);

    const link = await linkFor(email);
    expect(link).toMatch(/^http:\/\/localhost:4310\/verify-email\?token=/);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Email address confirmed" })).toBeFocused();
    await expectAccessible(page);
    await page.getByRole("link", { name: "Continue" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Robin Example" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("link", { name: "Edit your profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expectAccessible(page);

    expect(errors).toEqual([]);
  });
});

test.describe("passkeys", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.11" } });

  test("add one from the profile, rename it, sign in with it, and remove it", async ({ page }) => {
    const errors = watchConsole(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });
    const email = freshEmail("passkey");
    await signUpAndSignIn(page, "Passkey Example", email, PASSWORD);

    // The sign-up, confirmation and sign-in pages on the way here are the states the first
    // journey checks; the profile with no passkeys is not.
    await page.goto("/profile");
    await expect(page.getByText("You have no passkeys yet.")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove passkey / })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: /^Rename passkey / }).click();
    const passkeyName = page.getByLabel("Passkey name");
    await expect(passkeyName).toBeFocused();
    await expect(passkeyName).toHaveValue(/^Passkey added /);
    await expectAccessible(page);
    await passkeyName.fill("Work laptop");
    await passkeyName.press("Enter");
    await expect(page.getByText("Passkey renamed.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Remove passkey Work laptop, added / }),
    ).toBeVisible();
    // The form is gone, and focus is back on the button that opened it.
    await expect(
      page.getByRole("button", { name: /^Rename passkey Work laptop, added / }),
    ).toBeFocused();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Passkey Example" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.goto("/profile");
    await page.getByRole("button", { name: /^Remove passkey / }).click();
    await expect(page.getByText("Passkey removed.")).toBeVisible();
    await expect(page.getByText("You have no passkeys yet.")).toBeVisible();
    await expectAccessible(page);

    expect(errors).toEqual([]);
  });
});

test.describe("the admin user list", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.12" } });

  test("pages through the users, and keeps the pages after going Back", async ({ page }) => {
    const errors = watchConsole(page);
    const email = freshEmail("admin");
    await signUpAndSignIn(page, "Admin Example", email, PASSWORD);
    makeAdmin(email);
    // More than one page of users, newer than the admin.
    await signUpUsers(ADMIN_USERS_PAGE_SIZE + 1);

    await page.goto("/admin/users");
    const table = page.getByRole("region", { name: "Users" });
    await expect(table).toHaveAttribute("tabindex", "0");
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(ADMIN_USERS_PAGE_SIZE + 1);
    await expectAccessible(page);

    await page.getByRole("button", { name: "Load more" }).click();
    // The second page holds whatever is left: a full page on a database other runs have used,
    // only a few users on a fresh one.
    await expect.poll(() => rows.count()).toBeGreaterThan(ADMIN_USERS_PAGE_SIZE + 1);
    const loaded = await rows.count();

    await page.getByRole("navigation").getByRole("link", { name: "Profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your profile" })).toBeVisible();
    await page.goBack();

    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    // Both pages are still there. Where the page was scrolled is not restored (the router's
    // scrollRestoration is off); see plan 011, lead L2.
    await expect(rows).toHaveCount(loaded);

    expect(errors).toEqual([]);
  });
});
