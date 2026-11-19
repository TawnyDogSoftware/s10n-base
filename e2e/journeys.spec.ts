/**
 * The two browser journeys plan 000 and plans 004 to 005 ask for. Each runs from its own client
 * address (one trusted proxy hop), so the sign-in rate limit applies to it alone.
 */
import { expect, test } from "@playwright/test";

import { expectAccessible, freshEmail, linkFor, signUpAndSignIn, watchConsole } from "./support";

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
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expectAccessible(page);

    const link = await linkFor(email);
    expect(link).toMatch(/^http:\/\/localhost:4310\/verify-email\?token=/);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Email address confirmed" })).toBeVisible();
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

    expect(errors).toEqual([]);
  });
});

test.describe("passkeys", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.11" } });

  test("add one from the profile, sign in with it, and remove it", async ({ page }) => {
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

    await page.goto("/profile");
    await expect(page.getByText("You have no passkeys yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove passkey / })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Hello, Passkey Example" }),
    ).toBeVisible();

    await page.goto("/profile");
    await page.getByRole("button", { name: /^Remove passkey / }).click();
    await expect(page.getByText("Passkey removed.")).toBeVisible();
    await expect(page.getByText("You have no passkeys yet.")).toBeVisible();
    await expectAccessible(page);

    expect(errors).toEqual([]);
  });
});
