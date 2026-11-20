import { screen, waitFor } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import { describe, expect, it, vi } from "vitest";

import { router } from "../test/native";
import { createBackend, press, renderScreen, type } from "../test/render";
import { ForgotPasswordScreen } from "./forgot-password";
import { SignInScreen } from "./sign-in";
import { SignUpScreen } from "./sign-up";

function backendWithSam(verified = true) {
  const backend = createBackend();
  backend.addUser({ email: "sam@example.com", name: "Sam", verified });
  return backend;
}

describe("SignInScreen", () => {
  it("checks the fields before sending anything, and focuses the first error", async () => {
    const { backend } = renderScreen(<SignInScreen />);

    press("Sign in");

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(backend.requests).toHaveLength(0);
  });

  it("signs in, and the session the app reads afterwards is the user's", async () => {
    const { services } = renderScreen(<SignInScreen />, { backend: backendWithSam() });

    type("Email address", " sam@example.com ");
    type("Password", "correct horse");
    press("Sign in");

    await waitFor(() => {
      expect(services.gate.current()?.name).toBe("Sam");
    });
  });

  it("announces a refused sign-in", async () => {
    const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
    renderScreen(<SignInScreen />, { backend: backendWithSam() });

    type("Email address", "sam@example.com");
    type("Password", "wrong password");
    press("Sign in");

    const message = "The email address or password is not right.";
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(announce).toHaveBeenCalledWith(message);
  });

  it("tells an unverified user to check their email, with a resend", async () => {
    const { backend } = renderScreen(<SignInScreen />, { backend: backendWithSam(false) });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(
      await screen.findByText(/Confirm your email address before you sign in/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The link opens in your browser/)).toBeInTheDocument();
    press("Send the link again");
    expect(
      await screen.findByText("We sent a new link. It works for one hour."),
    ).toBeInTheDocument();
    expect(backend.calls("/api/auth/send-verification-email")).toHaveLength(1);
  });

  it("says the outcome is unknown when the answer is lost, then trusts the session read", async () => {
    const backend = backendWithSam();
    backend.failNext("/api/auth/sign-in/email", { kind: "network" });
    const { services } = renderScreen(<SignInScreen />, { backend });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(await screen.findByText("We could not confirm whether that worked")).toBeInTheDocument();
    expect(screen.getByText("You are not signed in.")).toBeInTheDocument();
    expect(services.gate.current()).toBeNull();
  });

  it("links to sign-up and the password reset", () => {
    renderScreen(<SignInScreen />);

    screen.getByRole("link", { name: "Create an account" }).click();
    screen.getByRole("link", { name: "Forgot your password?" }).click();

    expect(router.push.mock.calls).toEqual([["/sign-up"], ["/forgot-password"]]);
  });
});

describe("SignUpScreen", () => {
  it("creates the account, then says to check the email and finish in the browser", async () => {
    const { backend } = renderScreen(<SignUpScreen />);

    type("Name", "Ada");
    type("Email address", "ada@example.com");
    type("Password", "long enough");
    press("Create account");

    expect(await screen.findByText(/We sent a link to ada@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/The link opens in your browser/)).toBeInTheDocument();
    expect(backend.users.get("ada@example.com")?.name).toBe("Ada");
    press("Go to sign in");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it("uses Better Auth's password limits and the contract's name limit", async () => {
    const { backend } = renderScreen(<SignUpScreen />);

    type("Name", "x".repeat(101));
    type("Email address", "ada@example");
    type("Password", "short");
    press("Create account");

    expect(await screen.findByText("Use at most 100 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter an email address like name@example.com.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(backend.requests).toHaveLength(0);
  });

  it("explains an address that is already taken", async () => {
    renderScreen(<SignUpScreen />, { backend: backendWithSam() });

    type("Name", "Sam");
    type("Email address", "sam@example.com");
    type("Password", "long enough");
    press("Create account");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account already uses this email address. Sign in instead.",
    );
  });
});

describe("ForgotPasswordScreen", () => {
  it.each([
    ["an address with an account", "sam@example.com"],
    ["an address without one", "nobody@example.com"],
  ])("answers the same way for %s", async (_case, email) => {
    renderScreen(<ForgotPasswordScreen />, { backend: backendWithSam() });

    type("Email address", email);
    press("Send the link");

    expect(await screen.findByText(new RegExp(`If an account uses ${email}`))).toBeInTheDocument();
    expect(screen.getByText(/where you choose the new password/)).toBeInTheDocument();
  });

  it("reports a rate limit, which says nothing about the address", async () => {
    const backend = backendWithSam();
    backend.failNext("/api/auth/request-password-reset", {
      kind: "response",
      status: 429,
      body: { message: "Too many requests" },
    });
    renderScreen(<ForgotPasswordScreen />, { backend });

    type("Email address", "sam@example.com");
    press("Send the link");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Wait a minute and try again.",
    );
  });
});

describe("link-styled buttons", () => {
  it("take only the width of their text, so the rest of the row is not a link", async () => {
    renderScreen(<SignInScreen />);

    expect(await screen.findByRole("link", { name: "Forgot your password?" })).toHaveClass(
      "self-start",
    );
  });
});
