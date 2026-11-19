/** What every journey needs: page checks, the capture server's inbox, and fresh accounts. */
import { randomUUID } from "node:crypto";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { E2E_SES } from "./env";

/** Collects console errors and page errors, which include Content-Security-Policy violations. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

/** Fails on any serious or critical accessibility violation on the page as it is now. */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help}`);
  expect(blocking, page.url()).toEqual([]);
}

/** An address no earlier run has used. */
export function freshEmail(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

interface StoredEmail {
  readonly destination: { readonly to: readonly string[] };
  readonly body: { readonly text?: string };
}

/** The link in the newest email the capture server holds for `email`. */
export async function linkFor(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const response = await fetch(`${E2E_SES}/store`);
      const { emails } = (await response.json()) as { emails: StoredEmail[] };
      const text = emails.findLast((each) => each.destination.to.includes(email))?.body.text;
      link = /https?:\/\/\S+/.exec(text ?? "")?.[0];
      return link;
    })
    .toBeDefined();
  return link as string;
}

/** Signs up through the page, confirms the address from the email, and signs in. */
export async function signUpAndSignIn(page: Page, name: string, email: string, password: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto(await linkFor(email));
  await expect(page.getByRole("heading", { name: "Email address confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Hello, ${name}` })).toBeVisible();
}
