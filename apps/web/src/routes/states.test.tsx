/**
 * The states the main journeys pass by: failures, refusals, empty lists, and pages loaded with
 * extra search parameters.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { click, renderApp, type } from "../test/render";

function signedIn(email = "sam@example.com", role: "user" | "admin" = "user") {
  const backend = createFakeBackend();
  backend.addUser({ email, name: "Sam", role });
  backend.signInAs(email);
  return backend;
}

const rpcOk = (data: unknown) => ({
  kind: "response" as const,
  status: 200,
  body: { ok: true, data },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a page whose guard cannot read the session", () => {
  it("says the page could not be shown, and shows it after trying again", async () => {
    const backend = signedIn();
    backend.failNext("/api/app-auth/session", { kind: "network" });
    renderApp("/profile", backend);

    expect(
      await screen.findByRole("heading", { level: 1, name: "This page could not be shown" }),
    ).toBeInTheDocument();
    click("Try again");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Your profile" }),
    ).toBeInTheDocument();
  });
});

describe("/profile, when things go wrong", () => {
  it("says why the profile could not be read", async () => {
    const backend = signedIn();
    backend.failNext("/rpc", { kind: "network" });
    renderApp("/profile", backend);

    expect(
      await screen.findByText(
        "We could not reach the server. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an unconfirmed email address as such", async () => {
    const backend = createFakeBackend();
    backend.addUser({ email: "sam@example.com", name: "Sam", verified: false });
    backend.signInAs("sam@example.com");
    renderApp("/profile", backend);

    expect(await screen.findByText("Not confirmed")).toBeInTheDocument();
  });

  it("saves a name once, however often the form is sent while it saves", async () => {
    const backend = signedIn();
    renderApp("/profile", backend);
    await screen.findByLabelText("Name");
    const release = backend.hold("/rpc");

    type("Name", "Robin");
    const form = screen.getByRole("button", { name: "Save" }).closest("form");
    if (form === null) throw new Error("no form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    release();

    expect(await screen.findByText("Your name is saved.")).toBeInTheDocument();
    expect(
      backend
        .calls("/rpc")
        .filter((request) => JSON.stringify(request.body).includes("profile.update")),
    ).toHaveLength(1);
  });

  it("says the passkeys could not be listed when Better Auth refuses", async () => {
    const backend = signedIn();
    backend.failNext("/api/auth/passkey/list-user-passkeys", {
      kind: "response",
      status: 401,
      body: { code: "UNAUTHORIZED", message: "x" },
    });
    renderApp("/profile", backend);

    expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  });

  it("shows an empty list when the passkey answer is not a list", async () => {
    const backend = signedIn();
    backend.failNext("/api/auth/passkey/list-user-passkeys", {
      kind: "response",
      status: 200,
      body: { unexpected: true },
    });
    renderApp("/profile", backend);

    expect(await screen.findByText("You have no passkeys yet.")).toBeInTheDocument();
  });

  it("says why a passkey could not be removed", async () => {
    const backend = signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.passkeys = [{ id: "pk1", name: "Laptop", createdAt: "2026-11-01T10:00:00.000Z" }];
    renderApp("/profile", backend);
    await screen.findByText("Laptop");
    backend.failNext("/api/auth/passkey/delete-passkey", {
      kind: "response",
      status: 404,
      body: { code: "PASSKEY_NOT_FOUND", message: "x" },
    });

    click("Remove passkey Laptop");

    expect(await screen.findByRole("alert")).toHaveTextContent("That passkey no longer exists.");
  });

  it("says why adding a passkey failed", async () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    renderApp("/profile", signedIn());

    await screen.findByRole("button", { name: "Add a passkey" });
    click("Add a passkey");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("/admin/users, when things go wrong", () => {
  it("says why the first page could not be read", async () => {
    const backend = signedIn("admin@example.com", "admin");
    backend.failNext("/rpc", { kind: "network" });
    renderApp("/admin/users", backend);

    expect(
      await screen.findByText(
        "We could not reach the server. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("says when there are no users", async () => {
    const backend = signedIn("admin@example.com", "admin");
    backend.failNext("/rpc", rpcOk({ users: [], nextCursor: null }));
    renderApp("/admin/users", backend);

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  });

  it("shows a banned user as banned", async () => {
    const backend = signedIn("admin@example.com", "admin");
    backend.failNext(
      "/rpc",
      rpcOk({
        users: [
          {
            id: "u1",
            name: "Banned User",
            email: "b@example.com",
            role: "user",
            emailVerified: true,
            banned: true,
            createdAt: "2026-11-01T10:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    );
    renderApp("/admin/users", backend);

    expect(await screen.findByText("Banned User")).toBeInTheDocument();
    expect(screen.getByText("Banned")).toBeInTheDocument();
  });

  it("says why the next page could not be read, and keeps the first", async () => {
    const backend = signedIn("admin@example.com", "admin");
    for (let index = 0; index < 30; index += 1) {
      backend.addUser({ email: `user${String(index)}@example.com`, name: `User ${String(index)}` });
    }
    renderApp("/admin/users", backend);
    await screen.findByText("User 29");
    backend.failNext("/rpc", { kind: "network" });

    click("Load more");

    expect(
      await screen.findByText(
        "We could not reach the server. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("User 29")).toBeInTheDocument();
  });
});

describe("resending a confirmation email", () => {
  it.each([
    [
      "refused",
      { kind: "response" as const, status: 429, body: { code: "x", message: "x" } },
      "Too many attempts. Wait a minute and try again.",
    ],
    [
      "lost",
      { kind: "network" as const },
      "We could not reach the server. Check your connection and try again.",
    ],
  ])("after sign-up, says why when the resend is %s", async (_case, failure, message) => {
    const backend = createFakeBackend();
    renderApp("/sign-up", backend);
    await screen.findByLabelText("Name");
    type("Name", "Sam");
    type("Email address", "sam@example.com");
    type("Password", "a long enough passphrase");
    click("Create account");
    await screen.findByRole("button", { name: "Send the link again" });
    backend.failNext("/api/auth/send-verification-email", failure);

    click("Send the link again");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it.each([
    [
      "refused for too many attempts",
      { kind: "response" as const, status: 429, body: { code: "x", message: "x" } },
      "Too many attempts. Wait a minute and try again.",
    ],
    [
      "lost",
      { kind: "network" as const },
      "We could not reach the server. Check your connection and try again.",
    ],
  ])(
    "from a link that did not work, says why when the resend is %s",
    async (_case, failure, message) => {
      const backend = createFakeBackend();
      renderApp("/verify-email?token=not-a-token", backend);
      await screen.findByLabelText("Email address");
      backend.failNext("/api/auth/send-verification-email", failure);

      type("Email address", "sam@example.com");
      click("Send a new link");

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );
});

describe("/reset-password with an expired link", () => {
  it("offers to ask for a new one", async () => {
    const backend = createFakeBackend();
    renderApp("/reset-password?token=old", backend);
    await screen.findByLabelText("New password");
    backend.failNext("/api/auth/reset-password", {
      kind: "response",
      status: 400,
      body: { code: "TOKEN_EXPIRED", message: "x" },
    });

    type("New password", "a long enough passphrase");
    click("Save the new password");

    expect(await screen.findByRole("alert")).toHaveTextContent("This link has expired.");
    expect(screen.getByRole("link", { name: "Ask for a new link" })).toBeInTheDocument();
  });
});

describe("/sign-up with a page to return to", () => {
  it("keeps the redirect for after sign-in", async () => {
    const app = renderApp("/sign-up?redirect=%2Fprofile");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create an account" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(app.location()).toBe("/sign-up?redirect=%2Fprofile");
    });
  });
});
