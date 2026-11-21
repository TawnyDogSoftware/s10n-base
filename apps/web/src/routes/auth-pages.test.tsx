import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { click, renderApp, type, waitForLocation } from "../test/render";

function backendWith(...emails: string[]) {
  const backend = createFakeBackend();
  for (const email of emails) backend.addUser({ email, name: "Sam" });
  return backend;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/sign-up", () => {
  it("shows every field error, tied to its field, and moves focus to the first", async () => {
    const app = renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { level: 1, name: "Create an account" });

    type("Email address", "not-an-email");
    type(/^Password/, "short");
    click("Create account");

    expect(await screen.findByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter your name.");
    expect(screen.getByLabelText("Email address")).toHaveAccessibleDescription(
      "Enter an email address like name@example.com.",
    );
    expect(screen.getByLabelText(/^Password/)).toHaveAccessibleDescription(
      "At least 8 characters. Use at least 8 characters.",
    );
    expect(app.backend.calls("/api/auth/sign-up/email")).toEqual([]);
  });

  it("names a character a name cannot hold, on the name field", async () => {
    const app = renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { level: 1, name: "Create an account" });

    type("Name", "Sam\u0000");
    type("Email address", "sam@example.com");
    type(/^Password/, "long enough");
    click("Create account");

    expect(await screen.findByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    const name = screen.getByLabelText("Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(
      "The name contains a character that cannot be used: U+0000. Please try another name.",
    );
    expect(app.backend.calls("/api/auth/sign-up/email")).toEqual([]);
  });

  it("uses the autocomplete values password managers expect", async () => {
    renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { name: "Create an account" });

    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "new-password");
  });

  it("creates the account and says to check the email, with a resend", async () => {
    const app = renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { name: "Create an account" });

    type("Name", "  Robin  ");
    type("Email address", " robin@example.com ");
    type(/^Password/, "long enough");
    click("Create account");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/We sent a link to robin@example.com/)).toBeInTheDocument();
    expect(app.backend.calls("/api/auth/sign-up/email")[0]?.body).toEqual({
      name: "Robin",
      email: "robin@example.com",
      password: "long enough",
    });

    click("Send the link again");
    expect(
      await screen.findByText("We sent a new link. It works for 15 minutes."),
    ).toBeInTheDocument();
    expect(app.backend.calls("/api/auth/send-verification-email")).toHaveLength(1);
  });

  it("disables and relabels the button while pending, and sends once however often it is pressed", async () => {
    const app = renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { name: "Create an account" });
    const release = app.backend.hold("/api/auth/sign-up/email");

    type("Name", "Robin");
    type("Email address", "robin@example.com");
    type(/^Password/, "long enough");
    click("Create account");
    const pending = await screen.findByRole("button", { name: "Creating account…" });
    expect(pending).toBeDisabled();
    fireEvent.submit(pending.closest("form") as HTMLFormElement);
    fireEvent.submit(pending.closest("form") as HTMLFormElement);

    release();
    await screen.findByRole("heading", { name: "Check your email" });
    expect(app.backend.calls("/api/auth/sign-up/email")).toHaveLength(1);
  });

  it("explains a refusal from the server", async () => {
    renderApp("/sign-up", backendWith("taken@example.com"));
    await screen.findByRole("heading", { name: "Create an account" });

    type("Name", "Robin");
    type("Email address", "taken@example.com");
    type(/^Password/, "long enough");
    click("Create account");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account already uses this email address. Sign in instead.",
    );
  });

  it("says the outcome is unknown when the answer is lost", async () => {
    const app = renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { name: "Create an account" });
    app.backend.failNext("/api/auth/sign-up/email", { kind: "network", afterHandling: true });

    type("Name", "Robin");
    type("Email address", "robin@example.com");
    type(/^Password/, "long enough");
    click("Create account");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not confirm whether that worked");
    expect(alert).toHaveTextContent("You are not signed in.");
    expect(app.backend.calls("/api/app-auth/session").length).toBeGreaterThanOrEqual(2);
    // The check has finished: the notice never still says it is under way.
    expect(alert).not.toHaveTextContent(/checking/i);
  });
});

describe("/sign-in", () => {
  it("signs in and goes home", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    await waitForLocation(app, "/");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Hello, Sam" }),
    ).toBeInTheDocument();
  });

  it("offers passkeys in the browser's autofill and uses the right autocomplete values", async () => {
    renderApp("/sign-in", backendWith());
    await screen.findByRole("heading", { name: "Sign in" });

    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "autocomplete",
      "username webauthn",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("asks for both fields before sending anything", async () => {
    const app = renderApp("/sign-in", backendWith());
    await screen.findByRole("heading", { name: "Sign in" });

    click("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
    expect(app.backend.calls("/api/auth/sign-in/email")).toEqual([]);
  });

  it("explains a wrong password", async () => {
    renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });

    type("Email address", "sam@example.com");
    type("Password", "wrong");
    click("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The email address or password is not right.",
    );
  });

  it("shows an unverified account the check-your-email state, not an error", async () => {
    const backend = createFakeBackend();
    backend.addUser({ email: "new@example.com", verified: false });
    renderApp("/sign-in", backend);
    await screen.findByRole("heading", { name: "Sign in" });

    type("Email address", "new@example.com");
    type("Password", "correct horse");
    click("Sign in");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Check your email" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirm your email address before you sign in/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a rate limit", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/auth/sign-in/email", {
      kind: "response",
      status: 429,
      body: { message: "Too many requests" },
    });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts.");
  });

  it("goes on when the answer was lost but the server did sign the user in", async () => {
    const app = renderApp("/sign-in?redirect=%2Fprofile", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/auth/sign-in/email", { kind: "network", afterHandling: true });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    await waitForLocation(app, "/profile");
  });

  it("says the outcome is unknown when the answer was lost and the user is not signed in", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/auth/sign-in/email", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not confirm whether that worked");
    expect(alert).toHaveTextContent("You are not signed in.");
    expect(app.location()).toBe("/sign-in");
  });

  it("says the server cannot be reached when the session cannot be read either", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/auth/sign-in/email", { kind: "network" });
    app.backend.failNext("/api/app-auth/session", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reach the server to check your account.",
    );
  });

  it("says the server cannot be reached when sign-in succeeded but the session cannot be read", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/app-auth/session", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server accepted that, but we could not check your account afterwards.",
    );
    expect(app.location()).toBe("/sign-in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("checks again, without signing in again, when sign-in succeeded but the read failed", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/app-auth/session", { kind: "network" });
    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");
    await screen.findByRole("button", { name: "Check again" });

    click("Check again");

    await waitForLocation(app, "/");
    expect(app.backend.calls("/api/auth/sign-in/email")).toHaveLength(1);
  });

  it("checks again when neither the sign-in's answer nor the read arrived", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    app.backend.failNext("/api/auth/sign-in/email", { kind: "network" });
    app.backend.failNext("/api/app-auth/session", { kind: "network" });
    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");
    await screen.findByRole("button", { name: "Check again" });

    click("Check again");

    expect(await screen.findByText("You are not signed in.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(app.backend.calls("/api/auth/sign-in/email")).toHaveLength(1);
  });

  it("does not navigate for a sign-in the user left before it finished", async () => {
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    const release = app.backend.hold("/api/auth/sign-in/email");
    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");
    await waitFor(() => {
      expect(app.backend.calls("/api/auth/sign-in/email")).toHaveLength(1);
    });

    await act(() => app.router.navigate({ to: "/verify-email" }));
    release();

    await waitFor(() => {
      expect(app.services.gate.current()?.email).toBe("sam@example.com");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.location()).toBe("/verify-email");
  });

  it("explains, instead of offering, passkey sign-in where the browser has no passkeys", async () => {
    renderApp("/sign-in", backendWith());
    await screen.findByRole("heading", { name: "Sign in" });

    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).toBeNull();
    expect(screen.getByText("This browser cannot use passkeys.")).toBeInTheDocument();
  });

  it("reports a passkey sign-in that did not complete", async () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    const app = renderApp("/sign-in", backendWith());
    await screen.findByRole("heading", { name: "Sign in" });

    click("Sign in with a passkey");

    // jsdom has no authenticator, so the browser step fails as a cancellation would.
    expect(await screen.findByRole("alert")).toHaveTextContent("Passkey sign-in was cancelled.");
    expect(app.backend.calls("/api/auth/passkey/generate-authenticate-options")).toHaveLength(1);
  });
});

describe("/verify-email", () => {
  it("verifies the token from the link and offers a way on", async () => {
    const backend = createFakeBackend();
    backend.addUser({ email: "new@example.com", verified: false });
    const token = backend.issueToken("new@example.com", "verify");
    renderApp(`/verify-email?token=${token}`, backend);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Email address confirmed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/sign-in");
    expect(backend.users.get("new@example.com")?.verified).toBe(true);
    expect(backend.calls("/api/auth/verify-email")).toHaveLength(1);
  });

  it.each(["123456", "1e5", "true", "null", "a+b=c==", "12345678901234567890"])(
    "sends the token %j exactly as the link carried it",
    async (token) => {
      const backend = createFakeBackend();
      renderApp(`/verify-email?token=${encodeURIComponent(token)}`, backend);

      await screen.findByRole("heading", { name: "This link does not work" });
      expect(backend.calls("/api/auth/verify-email")[0]?.search).toBe(
        `?token=${encodeURIComponent(token)}`,
      );
    },
  );

  it("offers a new link for an expired or used token", async () => {
    const backend = createFakeBackend();
    backend.addUser({ email: "new@example.com", verified: false });
    renderApp("/verify-email?token=used", backend);

    expect(
      await screen.findByRole("heading", { name: "This link does not work" }),
    ).toBeInTheDocument();
    type("Email address", "new@example.com");
    click("Send a new link");

    expect(await screen.findByRole("status")).toHaveTextContent("We sent a new link.");
    expect(backend.calls("/api/auth/send-verification-email")[0]?.body).toEqual({
      email: "new@example.com",
    });
  });

  it.each([
    [429, { code: "RATE_LIMITED" }, "Too many attempts. Wait a minute and try again."],
    [500, { code: "INTERNAL_SERVER_ERROR" }, "Something went wrong. Try again."],
  ])(
    "does not call the link dead when the server answers %i, and its retry uses the same token",
    async (status, body, message) => {
      const backend = createFakeBackend();
      backend.addUser({ email: "new@example.com", verified: false });
      const token = backend.issueToken("new@example.com", "verify");
      backend.failNext("/api/auth/verify-email", { kind: "response", status, body });
      renderApp(`/verify-email?token=${token}`, backend);

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "This link does not work" })).toBeNull();
      click("Try again");

      expect(
        await screen.findByRole("heading", { name: "Email address confirmed" }),
      ).toBeInTheDocument();
      expect(backend.calls("/api/auth/verify-email").map((call) => call.search)).toEqual([
        `?token=${token}`,
        `?token=${token}`,
      ]);
    },
  );

  it("explains a link with no token, without calling the server", async () => {
    const backend = createFakeBackend();
    renderApp("/verify-email", backend);

    expect(
      await screen.findByRole("heading", { name: "This link is incomplete" }),
    ).toBeInTheDocument();
    expect(backend.calls("/api/auth/verify-email")).toEqual([]);
  });

  it("says the outcome is unknown when the answer is lost, and can try again", async () => {
    const backend = createFakeBackend();
    backend.addUser({ email: "new@example.com", verified: false });
    const token = backend.issueToken("new@example.com", "verify");
    backend.failNext("/api/auth/verify-email", { kind: "network" });
    renderApp(`/verify-email?token=${token}`, backend);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not confirm whether that worked",
    );
    click("Try again");

    expect(
      await screen.findByRole("heading", { name: "Email address confirmed" }),
    ).toBeInTheDocument();
  });
});

describe("an auth call that throws something unexpected", () => {
  it("leaves the verify page on an error with a retry, not on Confirming", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const backend = backendWith();
    const app = renderApp("/verify-email?token=t1", backend);
    const verify = vi
      .spyOn(app.services.auth, "verifyEmail")
      .mockRejectedValueOnce(new Error("adapter failed"));

    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    click("Try again");
    await waitFor(() => {
      expect(verify).toHaveBeenCalledTimes(2);
    });
    report.mockRestore();
  });

  it("ends the sign-in's pending state and says so", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { name: "Sign in" });
    vi.spyOn(app.services.auth, "signIn").mockRejectedValueOnce(new Error("adapter failed"));

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    click("Sign in");

    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(report).toHaveBeenCalled();
    report.mockRestore();
  });
});

/** At each focus call: the role of the focused field's error, or null when it has none yet. */
function watchFocus() {
  const seen: Array<string | null> = [];
  const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
  ) {
    const ids = (this.getAttribute("aria-describedby") ?? "").split(" ");
    const error = ids
      .map((id) => document.getElementById(id))
      .find((element) => element?.id.endsWith("-error"));
    seen.push(error === undefined || error === null ? null : (error.getAttribute("role") ?? ""));
  });
  return { seen, focus };
}

describe("a form replaced by its result", () => {
  it("moves focus to the result's heading after sign-up", async () => {
    renderApp("/sign-up", backendWith());
    await screen.findByRole("heading", { name: "Create an account" });
    type("Name", "Robin");
    type("Email address", "robin@example.com");
    type(/^Password/, "long enough");
    click("Create account");

    const result = await screen.findByRole("heading", { level: 1, name: "Check your email" });
    // The heading takes focus in an effect, just after it appears.
    await waitFor(() => {
      expect(result).toHaveFocus();
    });
  });

  it("moves focus to the result's heading after a reset request", async () => {
    renderApp("/forgot-password", backendWith());
    await screen.findByRole("heading", { name: "Reset your password" });
    type("Email address", "sam@example.com");
    click("Send the link");

    const result = await screen.findByRole("heading", { level: 1, name: "Check your email" });
    // The heading takes focus in an effect, just after it appears.
    await waitFor(() => {
      expect(result).toHaveFocus();
    });
  });

  it("moves focus to the result's heading after a password reset", async () => {
    const backend = backendWith("sam@example.com");
    const token = backend.issueToken("sam@example.com", "reset");
    renderApp(`/reset-password?token=${token}`, backend);
    await screen.findByRole("heading", { name: "Choose a new password" });
    type(/^New password/, "a brand new one");
    click("Save the new password");

    const result = await screen.findByRole("heading", { level: 1, name: "Password changed" });
    // The heading takes focus in an effect, just after it appears.
    await waitFor(() => {
      expect(result).toHaveFocus();
    });
  });

  it("moves focus to the result's heading when an email address is confirmed", async () => {
    const backend = backendWith();
    backend.addUser({ email: "new@example.com", verified: false });
    const token = backend.issueToken("new@example.com", "verify");
    renderApp(`/verify-email?token=${token}`, backend);

    const result = await screen.findByRole("heading", {
      level: 1,
      name: "Email address confirmed",
    });
    // The heading takes focus in an effect, just after it appears.
    await waitFor(() => {
      expect(result).toHaveFocus();
    });
  });
});

describe("feedback that no longer describes the form", () => {
  it("clears a field's error when its value changes, and leaves the others", async () => {
    renderApp("/sign-in", backendWith());
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    click("Sign in");
    await waitFor(() => {
      expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
    });

    type("Email address", "sam@example.com");

    expect(screen.getByLabelText("Email address")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears a refusal when a field it concerned changes", async () => {
    renderApp("/sign-in", backendWith("sam@example.com"));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    type("Email address", "sam@example.com");
    type("Password", "wrong password");
    click("Sign in");
    await screen.findByRole("alert");

    type("Password", "correct horse");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["/sign-in", "/api/auth/sign-in/email", "Sign in"],
    ["/sign-up", "/api/auth/sign-up/email", "Create account"],
  ])("on %s keeps the fields still while the request runs", async (path, route, submit) => {
    const app = renderApp(path, backendWith());
    await screen.findByLabelText("Email address");
    if (path === "/sign-up") type("Name", "Robin");
    type("Email address", "robin@example.com");
    type(/^Password/, "long enough password");
    const release = app.backend.hold(route);

    click(submit);

    await waitFor(() => {
      expect(screen.getByLabelText("Email address")).toBeDisabled();
    });
    expect(screen.getByLabelText(/^Password/)).toBeDisabled();
    release();
    await waitFor(() => {
      expect(app.backend.calls("/api/app-auth/session").length).toBeGreaterThan(1);
    });
  });
});

describe("a field error", () => {
  it.each([
    // A single field: its error is the alert.
    ["/forgot-password", "Reset your password", "Send the link", "alert"],
    // Several fields: the summary is the alert, and the field's error is there to be read.
    ["/sign-in", "Sign in", "Sign in", ""],
  ])("on %s exists before focus moves to the field", async (path, heading, submit, role) => {
    renderApp(path, backendWith());
    await screen.findByRole("heading", { level: 1, name: heading });
    const { seen, focus } = watchFocus();

    click(submit);

    await waitFor(() => {
      expect(seen).toEqual([role]);
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    focus.mockRestore();
  });
});

describe("/forgot-password", () => {
  it.each(["sam@example.com", "nobody@example.com"])(
    "answers the same way for %s, whether or not it has an account",
    async (email) => {
      renderApp("/forgot-password", backendWith("sam@example.com"));
      await screen.findByRole("heading", { name: "Reset your password" });

      type("Email address", email);
      click("Send the link");

      expect(
        await screen.findByRole("heading", { level: 1, name: "Check your email" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        `If an account uses ${email}, we sent it a link to reset the password.`,
      );
    },
  );

  it("validates the address first", async () => {
    const app = renderApp("/forgot-password", backendWith());
    await screen.findByRole("heading", { name: "Reset your password" });

    click("Send the link");

    expect(screen.getByLabelText("Email address")).toHaveAccessibleDescription(
      "Enter your email address.",
    );
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(app.backend.calls("/api/auth/request-password-reset")).toEqual([]);
  });

  it("reports a rate limit", async () => {
    const app = renderApp("/forgot-password", backendWith());
    await screen.findByRole("heading", { name: "Reset your password" });
    app.backend.failNext("/api/auth/request-password-reset", {
      kind: "response",
      status: 429,
      body: { message: "Too many requests" },
    });

    type("Email address", "sam@example.com");
    click("Send the link");

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts.");
  });
});

describe("/reset-password", () => {
  it("sets the new password, then offers sign-in", async () => {
    const backend = backendWith("sam@example.com");
    const token = backend.issueToken("sam@example.com", "reset");
    renderApp(`/reset-password?token=${token}`, backend);
    await screen.findByRole("heading", { name: "Choose a new password" });

    expect(screen.getByLabelText(/^New password/)).toHaveAttribute("autocomplete", "new-password");
    type(/^New password/, "a brand new one");
    click("Save the new password");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Password changed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(backend.users.get("sam@example.com")?.password).toBe("a brand new one");
  });

  it("does not offer the same form again after a reset whose answer was lost", async () => {
    const backend = backendWith("sam@example.com");
    const token = backend.issueToken("sam@example.com", "reset");
    renderApp(`/reset-password?token=${token}`, backend);
    await screen.findByRole("heading", { name: "Choose a new password" });
    backend.failNext("/api/auth/reset-password", { kind: "network", afterHandling: true });

    type(/^New password/, "a brand new one");
    click("Save the new password");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your password may have changed" }),
    ).toBeInTheDocument();
    // Sending the same token again would be refused as used, and read as "this link does not work".
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Ask for a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("starts clean when a new link opens the page", async () => {
    const backend = backendWith("sam@example.com");
    const first = backend.issueToken("sam@example.com", "reset");
    const app = renderApp(`/reset-password?token=${first}`, backend);
    await screen.findByRole("heading", { name: "Choose a new password" });
    backend.failNext("/api/auth/reset-password", { kind: "network" });
    type(/^New password/, "a brand new one");
    click("Save the new password");
    await screen.findByRole("heading", { level: 1, name: "Your password may have changed" });

    const second = backend.issueToken("sam@example.com", "reset");
    await act(() => app.router.navigate({ to: "/reset-password", search: { token: second } }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Choose a new password" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^New password/)).toHaveValue("");
  });

  it("keeps a numeric-looking token a string", async () => {
    const backend = backendWith("sam@example.com");
    renderApp("/reset-password?token=000123", backend);
    await screen.findByRole("heading", { name: "Choose a new password" });

    type(/^New password/, "a brand new one");
    click("Save the new password");

    await screen.findByRole("alert");
    expect(backend.calls("/api/auth/reset-password")[0]?.body).toEqual({
      token: "000123",
      newPassword: "a brand new one",
    });
  });

  it("refuses a short password before sending", async () => {
    const backend = backendWith();
    renderApp("/reset-password?token=t", backend);
    await screen.findByRole("heading", { name: "Choose a new password" });

    type(/^New password/, "short");
    click("Save the new password");

    expect(screen.getByLabelText(/^New password/)).toHaveAccessibleDescription(
      "At least 8 characters. Use at least 8 characters.",
    );
    expect(backend.calls("/api/auth/reset-password")).toEqual([]);
  });

  it("explains an invalid token and links to a new one", async () => {
    renderApp("/reset-password?token=expired", backendWith());
    await screen.findByRole("heading", { name: "Choose a new password" });

    type(/^New password/, "a brand new one");
    click("Save the new password");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This link does not work. Ask for a new one.");
    expect(within(alert).getByRole("link", { name: "Ask for a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("explains a link with no token", async () => {
    renderApp("/reset-password", backendWith());

    expect(
      await screen.findByRole("heading", { name: "This link is incomplete" }),
    ).toBeInTheDocument();
  });

  it("says the outcome is unknown when the answer is lost", async () => {
    const backend = backendWith("sam@example.com");
    const token = backend.issueToken("sam@example.com", "reset");
    backend.failNext("/api/auth/reset-password", { kind: "network", afterHandling: true });
    renderApp(`/reset-password?token=${token}`, backend);
    await screen.findByRole("heading", { name: "Choose a new password" });
    // The reads so far are the page's own; the one that settles the reset comes after.
    const readsBefore = backend.calls("/api/app-auth/session").length;

    type(/^New password/, "a brand new one");
    click("Save the new password");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your password may have changed" }),
    ).toBeInTheDocument();
    expect(backend.calls("/api/app-auth/session").length).toBeGreaterThan(readsBefore);
  });
});
