import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { click, renderApp, type, waitForLocation } from "../test/render";

function backendWith(...emails: string[]) {
  const backend = createFakeBackend();
  for (const email of emails) backend.addUser({ email, name: email.split("@")[0] ?? "" });
  return backend;
}

describe("requireSession", () => {
  it("sends a signed-out visitor to sign-in with the page to return to", async () => {
    const app = renderApp("/profile?tab=a%2Bb", backendWith());

    await waitForLocation(app, "/sign-in?redirect=%2Fprofile%3Ftab%3Da%252Bb");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("leaves out the redirect for the home page", async () => {
    const app = renderApp("/", backendWith());

    await waitForLocation(app, "/sign-in");
  });

  it("returns the visitor to that page after signing in", async () => {
    const app = renderApp("/profile", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    await waitForLocation(app, "/profile");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your profile" }),
    ).toBeInTheDocument();
  });

  it("lets a signed-in user through", async () => {
    const backend = backendWith("sam@example.com");
    backend.signInAs("sam@example.com");

    const app = renderApp("/profile", backend);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your profile" }),
    ).toBeInTheDocument();
    expect(app.location()).toBe("/profile");
  });
});

describe("redirectSignedIn", () => {
  it.each(["/sign-in", "/sign-up", "/forgot-password"])(
    "sends a signed-in user from %s to home",
    async (path) => {
      const backend = backendWith("sam@example.com");
      backend.signInAs("sam@example.com");

      const app = renderApp(path, backend);

      await waitForLocation(app, "/");
      expect(
        await screen.findByRole("heading", { level: 1, name: "Hello, sam" }),
      ).toBeInTheDocument();
    },
  );

  it("honours a safe redirect", async () => {
    const backend = backendWith("sam@example.com");
    backend.signInAs("sam@example.com");

    const app = renderApp("/sign-in?redirect=%2Fprofile", backend);

    await waitForLocation(app, "/profile");
  });

  it.each([
    "https%3A%2F%2Fevil.example.com%2F",
    "%2F%2Fevil.example.com",
    "%2F%5Cevil.example.com",
    "javascript%3Aalert(1)",
  ])("ignores the unsafe redirect %s and goes home", async (target) => {
    const backend = backendWith("sam@example.com");
    backend.signInAs("sam@example.com");

    const app = renderApp(`/sign-in?redirect=${target}`, backend);

    await waitForLocation(app, "/");
  });

  it("ignores an unsafe redirect after signing in too", async () => {
    const app = renderApp(
      "/sign-in?redirect=%2F%2Fevil.example.com",
      backendWith("sam@example.com"),
    );
    await screen.findByRole("heading", { name: "Sign in" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    await waitForLocation(app, "/");
  });
});

describe("visitor-only pages", () => {
  it.each([
    ["/sign-in?redirect=%2Fprofile", "/profile"],
    ["/sign-up", "/"],
    ["/forgot-password", "/"],
  ])("leave %s when a session appears while they are open", async (path, target) => {
    const app = renderApp(path, backendWith("sam@example.com"));
    await screen.findByRole("textbox", { name: "Email address" });

    // Signed in in another tab; this tab learns of it when it reads the session.
    app.backend.signInAs("sam@example.com");
    await act(() => app.services.gate.refresh());

    await waitForLocation(app, target);
  });
});

describe("links between the visitor pages", () => {
  it.each([
    ["/sign-in", "Create an account"],
    ["/sign-in", "Forgot your password?"],
    ["/sign-up", "Sign in"],
    ["/forgot-password", "Back to sign in"],
  ])("from %s, %s keeps where to go after signing in", async (path, link) => {
    renderApp(`${path}?redirect=%2Fprofile`, backendWith());

    const anchor = await screen.findByRole("link", { name: link });

    expect(anchor.getAttribute("href")).toMatch(/\?redirect=%2Fprofile$/);
  });

  it("drops a redirect that is not a path on this site", async () => {
    renderApp("/sign-in?redirect=https%3A%2F%2Fexample.com", backendWith());

    const anchor = await screen.findByRole("link", { name: "Create an account" });

    expect(anchor.getAttribute("href")).toBe("/sign-up");
  });
});
