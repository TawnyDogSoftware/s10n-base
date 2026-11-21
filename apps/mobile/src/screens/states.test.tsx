/**
 * The states the main journeys pass by on mobile: failures, refusals, lost answers, empty lists
 * and the links between the signed-out screens.
 */
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReactI18n } from "@s10n-base/i18n/react";

import { SignOutButton } from "../components/sign-out-button";
import { ActionOutcome, UnknownOutcome } from "../components/unknown-outcome";
import { Button } from "../components/ui";
import { authStoragePrefix, createMobileAuth, withAuthCookie } from "../lib/auth";
import { AppProviders } from "../providers";
import { useServices } from "../services";
import { router, secureStore } from "../test/native";
import {
  API,
  createBackend,
  createTestServices,
  press,
  renderScreen,
  signIn,
  type,
} from "../test/render";
import { ForgotPasswordScreen } from "./forgot-password";
import { ProfileScreen } from "./profile";
import { SignInScreen } from "./sign-in";
import { SignUpScreen } from "./sign-up";
import { UsersScreen } from "./users";

const NETWORK = "We could not reach the server. Check your connection and try again.";

async function signedIn(role: "user" | "admin" = "user") {
  const backend = createBackend();
  backend.addUser({ email: "sam@example.com", name: "Sam", role });
  const services = createTestServices(backend);
  await signIn(services, "sam@example.com");
  return { backend, services };
}

const rpcOk = (data: unknown) => ({
  kind: "response" as const,
  status: 200,
  body: { ok: true, data },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the signed-out screens' links", () => {
  it("go back to sign in from sign-up", () => {
    renderScreen(<SignUpScreen />);

    screen.getByRole("link", { name: "Sign in" }).click();

    expect(router.replace).toHaveBeenLastCalledWith("/sign-in");
  });

  it("go back to sign in from the reset request, before and after sending it", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    renderScreen(<ForgotPasswordScreen />, { backend });
    router.replace.mockClear();

    const before = screen.getByRole("link", { name: "Back to sign in" });
    before.click();
    type("Email address", "sam@example.com");
    press("Send the link");
    await screen.findByRole("heading", { name: "Check your email" });
    const after = screen.getByRole("link", { name: "Back to sign in" });
    after.click();

    expect(router.replace.mock.calls).toEqual([["/sign-in"], ["/sign-in"]]);
    // A new button, not the form's reused: react-native-web gives a reused button its new
    // handler only in an effect, so a press before that ran the form's handler.
    expect(before.isConnected).toBe(false);
  });

  it("checks the reset request's address before sending, and focuses it", async () => {
    const { backend } = renderScreen(<ForgotPasswordScreen />);

    type("Email address", "not an address");
    press("Send the link");

    expect(
      await screen.findByText("Enter an email address like name@example.com."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(backend.requests).toHaveLength(0);
  });
});

async function checkEmailScreen() {
  const backend = createBackend();
  backend.addUser({ email: "sam@example.com", verified: false });
  renderScreen(<SignInScreen />, { backend });
  type("Email address", "sam@example.com");
  type("Password", "correct horse");
  press("Sign in");
  await screen.findByRole("button", { name: "Send the link again" });
  return backend;
}

describe("SignInScreen for an unconfirmed address", () => {
  it("goes back to the sign-in form", async () => {
    await checkEmailScreen();

    press("Go to sign in");

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it.each([
    [
      "refused",
      { kind: "response" as const, status: 429, body: { code: "x", message: "x" } },
      "Too many attempts. Wait a minute and try again.",
    ],
    ["lost", { kind: "network" as const }, NETWORK],
  ])("says why when the resend is %s", async (_case, failure, message) => {
    const backend = await checkEmailScreen();
    backend.failNext("/api/auth/send-verification-email", failure);

    press("Send the link again");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});

describe("an auth call that throws something unexpected", () => {
  it("ends the sign-in's pending state and says so", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    const { services } = renderScreen(<SignInScreen />, { backend });
    vi.spyOn(services.auth, "signIn").mockRejectedValueOnce(new Error("SecureStore failed"));

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    report.mockRestore();
  });
});

describe("a sign-in whose answer or session read is lost", () => {
  it("says it is signed in but could not confirm, when only the read after it failed", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    renderScreen(<SignInScreen />, { backend });
    backend.failNext("/api/app-auth/session", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server accepted that, but we could not check your account afterwards.",
    );
  });

  it("checks again, without signing in again, when only the read after it failed", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    const { services } = renderScreen(<SignInScreen />, { backend });
    backend.failNext("/api/app-auth/session", { kind: "network" });
    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");
    await screen.findByRole("button", { name: "Check again" });

    press("Check again");

    await waitFor(() => {
      expect(services.gate.current()?.email).toBe("sam@example.com");
    });
    expect(backend.calls("/api/auth/sign-in/email")).toHaveLength(1);
  });

  it("says it cannot tell, and that the device is offline, when both were lost", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    renderScreen(<SignInScreen />, { backend });
    backend.failNext("/api/auth/sign-in/email", { kind: "network" });
    backend.failNext("/api/app-auth/session", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not confirm whether that worked",
    );
  });

  it("says no one is signed in when the answer was lost and the session reads signed out", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    renderScreen(<SignInScreen />, { backend });
    backend.failNext("/api/auth/sign-in/email", { kind: "network" });

    type("Email address", "sam@example.com");
    type("Password", "correct horse");
    press("Sign in");

    expect(await screen.findByRole("alert")).toHaveTextContent("You are not signed in.");
  });
});

describe("SignOutButton when the network fails", () => {
  it("trusts a confirmed sign-out when the read after it fails", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<SignOutButton />, { backend, services });
    backend.failNext("/api/app-auth/session", { kind: "network" });

    press("Sign out");

    await waitFor(() => {
      expect(services.gate.current()).toBeNull();
    });
  });

  it("says it cannot tell when both the sign-out and the read after it were lost", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<SignOutButton />, { backend, services });
    backend.failNext("/api/auth/sign-out", { kind: "network" });
    backend.failNext("/api/app-auth/session", { kind: "network" });

    press("Sign out");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not confirm whether that worked",
    );
  });
});

describe("ProfileScreen when things go wrong", () => {
  it("says why the profile could not be read", async () => {
    const { backend, services } = await signedIn();
    backend.failNext("/rpc", { kind: "network" });
    renderScreen(<ProfileScreen />, { backend, services });

    expect(await screen.findByText(NETWORK)).toBeInTheDocument();
  });

  it("shows an unconfirmed address as such", async () => {
    const { backend, services } = await signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.verified = false;
    renderScreen(<ProfileScreen />, { backend, services });

    expect(await screen.findByText("Not confirmed")).toBeInTheDocument();
  });

  it("saves once however often Save is pressed while saving, and says why a save failed", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<ProfileScreen />, { backend, services });
    await screen.findByLabelText("Name");
    const release = backend.hold("/rpc");
    backend.failNext("/rpc", { kind: "network" });

    type("Name", "Robin");
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    release();

    expect(await screen.findByText(NETWORK)).toBeInTheDocument();
    expect(
      backend
        .calls("/rpc")
        .filter((request) => JSON.stringify(request.body).includes("profile.update")),
    ).toHaveLength(1);
  });
});

describe("UsersScreen when things go wrong", () => {
  it("says why the first page could not be read", async () => {
    const { backend, services } = await signedIn("admin");
    backend.failNext("/rpc", { kind: "network" });
    renderScreen(<UsersScreen />, { backend, services });

    expect(await screen.findByText(NETWORK)).toBeInTheDocument();
  });

  it("says when there are no users", async () => {
    const { backend, services } = await signedIn("admin");
    backend.failNext("/rpc", rpcOk({ users: [], nextCursor: null }));
    renderScreen(<UsersScreen />, { backend, services });

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  });

  it("shows an unconfirmed, banned user as such", async () => {
    const { backend, services } = await signedIn("admin");
    backend.failNext(
      "/rpc",
      rpcOk({
        users: [
          {
            id: "u1",
            name: "Banned User",
            email: "b@example.com",
            role: "user",
            emailVerified: false,
            banned: true,
            createdAt: "2026-11-01T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    );
    renderScreen(<UsersScreen />, { backend, services });

    expect(await screen.findByText("Status: Banned")).toBeInTheDocument();
    expect(screen.getByText("Email confirmed: No")).toBeInTheDocument();
  });

  it("says why the next page could not be read, and keeps the first", async () => {
    const { backend, services } = await signedIn("admin");
    for (let index = 0; index < 30; index += 1) {
      backend.addUser({ email: `user${String(index)}@example.com`, name: `User ${String(index)}` });
    }
    renderScreen(<UsersScreen />, { backend, services });
    await screen.findByText("User 29");
    backend.failNext("/rpc", { kind: "network" });

    press("Load more");

    expect(await screen.findByText(NETWORK)).toBeInTheDocument();
    expect(screen.getByText("User 29")).toBeInTheDocument();
  });
});

describe("the building blocks", () => {
  it("Button keeps its own label while pending when it has no pending label", () => {
    render(
      <Button pending onPress={() => {}}>
        Save
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("ActionOutcome shows nothing for an accepted action with nothing to confirm", () => {
    const { container } = render(
      <AppProviders services={createTestServices(createBackend())} i18n={createReactI18n(["en"])}>
        <ActionOutcome
          outcome={{ kind: "done", value: { ok: true, data: null }, session: null }}
          signedInText="Signed in."
        />
      </AppProviders>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("UnknownOutcome says what a session means for the action when there is one", () => {
    render(
      <AppProviders services={createTestServices(createBackend())} i18n={createReactI18n(["en"])}>
        <UnknownOutcome
          session={{
            userId: "u1",
            email: "sam@example.com",
            name: "Sam",
            image: null,
            role: "user",
            emailVerified: true,
            expiresAt: "2099-01-01T00:00:00.000Z",
          }}
          signedInText="You are still signed in."
        />
      </AppProviders>,
    );

    expect(screen.getByText("You are still signed in.")).toBeInTheDocument();
  });

  it("useServices needs a ServicesProvider above it", () => {
    expect(() => renderHook(() => useServices())).toThrow(
      "useServices needs a ServicesProvider above it.",
    );
  });
});

describe("the auth client's defaults", () => {
  it("uses the platform's fetch, and stores a first cookie when none is stored yet", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    vi.stubGlobal("fetch", backend.fetch);
    secureStore.clear();
    const auth = createMobileAuth({ baseUrl: API, scheme: "s10nbase-dev" });

    expect(
      await auth.signIn({ email: "sam@example.com", password: "correct horse" }),
    ).toMatchObject({
      ok: true,
    });
    secureStore.clear();
    await auth.storeCookies("s10n-base.session_token=abc; Path=/; HttpOnly", auth.generation());

    expect(secureStore.get(`${authStoragePrefix(API)}_cookie`)).toContain("abc");
  });

  it("sends with the platform's fetch", async () => {
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return Promise.resolve(new Response("{}"));
    });

    const response = await withAuthCookie({
      cookie: () => Promise.resolve("s10n-base.session_token=old"),
      generation: () => 0,
      storeCookies: () => Promise.resolve(),
    })(`${API}/rpc`);

    expect(response.ok).toBe(true);
    expect(seen[0]?.get("cookie")).toBe("s10n-base.session_token=old");
  });
});
