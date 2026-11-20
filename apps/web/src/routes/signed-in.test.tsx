import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { click, renderApp, type, waitForLocation } from "../test/render";
import { ADMIN_USERS_PAGE_SIZE } from "./admin-users";

function signedIn(email = "sam@example.com", role: "user" | "admin" = "user") {
  const backend = createFakeBackend();
  backend.addUser({ email, name: "Sam", role });
  backend.signInAs(email);
  return backend;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/ (home)", () => {
  it("greets the user and links to the profile, with no users link for a non-admin", async () => {
    renderApp("/", signedIn());

    expect(
      await screen.findByRole("heading", { level: 1, name: "Hello, Sam" }),
    ).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).getByRole("link", { name: "Edit your profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(within(main).queryByRole("link", { name: "See all users" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation")).queryByRole("link", { name: "Users" }),
    ).not.toBeInTheDocument();
  });

  it("links an admin to the user list", async () => {
    renderApp("/", signedIn("admin@example.com", "admin"));

    await screen.findByRole("heading", { level: 1, name: "Hello, Sam" });
    expect(screen.getByRole("link", { name: "See all users" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(
      within(screen.getByRole("navigation")).getByRole("link", { name: "Users" }),
    ).toBeInTheDocument();
  });
});

describe("/profile", () => {
  it("shows the name, email, its confirmation state and the join date", async () => {
    renderApp("/profile", signedIn());

    expect(await screen.findByLabelText("Name")).toHaveValue("Sam");
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText(/^Member since /)).toBeInTheDocument();
  });

  it("saves a new name, and the greeting shows it", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");

    type("Name", "  Sam Renamed ");
    click("Save");

    expect(await screen.findByText("Your name is saved.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Sam Renamed");
    expect(app.backend.calls("/rpc").map((call) => call.body)).toContainEqual({
      method: "profile.update",
      payload: { userId: "user-1", name: "Sam Renamed" },
    });
    await act(() => app.router.navigate({ to: "/" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Hello, Sam Renamed" }),
    ).toBeInTheDocument();
  });

  it("keeps what the user typed while a save was pending", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    const release = app.backend.hold("/rpc");

    type("Name", "Robin");
    click("Save");
    await waitFor(() => {
      expect(app.backend.calls("/rpc").at(-1)?.body).toMatchObject({ method: "profile.update" });
    });
    type("Name", "River");
    release();

    await waitFor(() => {
      expect(app.backend.users.get("sam@example.com")?.name).toBe("Robin");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });
    expect(screen.getByLabelText("Name")).toHaveValue("River");
    expect(screen.queryByText("Your name is saved.")).not.toBeInTheDocument();
  });

  it("shows a name changed elsewhere while the field is untouched, and keeps a draft", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    const sam = app.backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    const reread = () =>
      act(() => app.services.gate.queryClient.invalidateQueries({ queryKey: ["user"] }));

    sam.name = "Changed Elsewhere";
    await reread();
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Changed Elsewhere");
    });

    type("Name", "My draft");
    sam.name = "Changed Again";
    await reread();
    await waitFor(() => {
      expect(
        app.backend
          .calls("/rpc")
          .filter((call) => JSON.stringify(call.body).includes("profile.get")),
      ).toHaveLength(3);
    });
    expect(screen.getByLabelText("Name")).toHaveValue("My draft");
  });

  it("reads the profile again when a save's answer is lost", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    const reads = () =>
      app.backend.calls("/rpc").filter((call) => JSON.stringify(call.body).includes("profile.get"));
    expect(reads()).toHaveLength(1);
    app.backend.failNext("/rpc", { kind: "network", afterHandling: true });

    type("Name", "Lost Answer");
    click("Save");

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(reads()).toHaveLength(2);
    });
  });

  it("sends one save for two submits before the page re-renders", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    type("Name", "Once");

    const form = screen.getByRole("button", { name: "Save" }).closest("form");
    if (form === null) throw new Error("no form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    await screen.findByText("Your name is saved.");
    expect(
      app.backend.calls("/rpc").filter((call) => JSON.stringify(call.body).includes("update")),
    ).toHaveLength(1);
  });

  it("checks the name before sending it", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");

    type("Name", "   ");
    click("Save");

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Enter your name.");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    type("Name", "x".repeat(101));
    click("Save");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      "Use at most 100 characters.",
    );
    expect(
      app.backend
        .calls("/rpc")
        .filter((call) => (call.body as { method: string }).method === "profile.update"),
    ).toEqual([]);
  });

  it("lists passkeys and removes one, then reads the list again", async () => {
    const backend = signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.passkeys = [
      { id: "pk1", name: "Laptop", createdAt: "2026-11-01T10:00:00.000Z" },
      { id: "pk2", name: null, createdAt: "2026-11-02T10:00:00.000Z" },
    ];
    renderApp("/profile", backend);

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("Passkey")).toBeInTheDocument();
    click("Remove passkey Laptop");

    expect(await screen.findByText("Passkey removed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
    expect(backend.calls("/api/auth/passkey/list-user-passkeys").length).toBeGreaterThanOrEqual(2);
  });

  it("says when the browser cannot use passkeys", async () => {
    renderApp("/profile", signedIn());

    expect(await screen.findByText("This browser cannot use passkeys.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a passkey" })).not.toBeInTheDocument();
  });

  it("offers to add a passkey where the browser supports them", async () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    renderApp("/profile", signedIn());

    expect(await screen.findByRole("button", { name: "Add a passkey" })).toBeInTheDocument();
    expect(await screen.findByText("You have no passkeys yet.")).toBeInTheDocument();
  });

  it("says the outcome is unknown when removing a passkey loses its answer", async () => {
    const backend = signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.passkeys = [{ id: "pk1", name: "Laptop", createdAt: "2026-11-01T10:00:00.000Z" }];
    renderApp("/profile", backend);
    await screen.findByText("Laptop");
    backend.failNext("/api/auth/passkey/delete-passkey", { kind: "network", afterHandling: true });

    click("Remove passkey Laptop");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not confirm whether that worked");
    expect(alert).toHaveTextContent("You are still signed in.");
    // The list read afterwards is the truth: the passkey was removed.
    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
  });

  it("signs out and goes to sign-in", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");

    click("Sign out");

    await waitForLocation(app, "/sign-in");
    expect(app.backend.signedInUser()).toBeUndefined();
  });

  it("goes to sign-in when the sign-out answer is lost but the server signed out", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    app.backend.failNext("/api/auth/sign-out", { kind: "network", afterHandling: true });

    click("Sign out");

    await waitForLocation(app, "/sign-in");
  });

  it("goes to sign-in after a confirmed sign-out even when the session cannot be read afterwards", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    app.backend.failNext("/api/app-auth/session", { kind: "network" });

    click("Sign out");

    // The server answered the sign-out, and its answer cleared the cookie.
    await waitForLocation(app, "/sign-in");
    expect(app.services.gate.current()).toBeNull();
    expect(screen.queryByText("sam@example.com")).not.toBeInTheDocument();
  });

  it("says the user is still signed in when the sign-out answer is lost and it did not happen", async () => {
    const app = renderApp("/profile", signedIn());
    await screen.findByLabelText("Name");
    app.backend.failNext("/api/auth/sign-out", { kind: "network" });

    click("Sign out");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not confirm whether that worked");
    expect(alert).toHaveTextContent("You are still signed in.");
    expect(app.location()).toBe("/profile");
  });
});

describe("switching user", () => {
  it("never shows the previous user's profile once another user is signed in", async () => {
    const backend = signedIn("alice@example.com");
    backend.addUser({ email: "bob@example.com", name: "Bob" });
    const alice = backend.users.get("alice@example.com");
    if (alice === undefined) throw new Error("no user");
    alice.name = "Alice";
    const app = renderApp("/profile", backend);
    expect(await screen.findByLabelText("Name")).toHaveValue("Alice");

    // Bob signs in in another tab; this tab learns of it when it reads the session.
    backend.signInAs("bob@example.com");
    const release = backend.hold("/rpc");
    await act(() => app.services.gate.refresh());

    // The cache is purged in the same call that accepted Bob's session.
    expect(
      app.services.gate.queryClient.getQueryCache().findAll({ queryKey: ["user", alice.id] }),
    ).toEqual([]);
    // Bob's profile is still held, and Alice's has already left the screen.
    await waitFor(() => expect(screen.queryByDisplayValue("Alice")).not.toBeInTheDocument());
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
    expect(backend.calls("/rpc").at(-1)?.body).toEqual({ method: "profile.get", payload: {} });
    release();
    expect(await screen.findByLabelText("Name")).toHaveValue("Bob");
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("never saves a name typed for one user after another tab signed in as someone else", async () => {
    const backend = signedIn("alice@example.com");
    backend.addUser({ email: "bob@example.com", name: "Bob" });
    renderApp("/profile", backend);
    expect(await screen.findByLabelText("Name")).toHaveValue("Sam");

    // Another tab signs out and in as Bob; this tab's session is still fresh in its cache.
    backend.signInAs("bob@example.com");
    type("Name", "Typed for Alice");
    click("Save");

    await waitFor(() => {
      expect(
        backend.calls("/rpc").filter((call) => JSON.stringify(call.body).includes("update")),
      ).toHaveLength(1);
    });
    expect(backend.users.get("bob@example.com")?.name).toBe("Bob");
    expect(backend.users.get("alice@example.com")?.name).toBe("Sam");
    // The tab re-reads the session and shows Bob.
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Bob"));
  });
});

describe("a session that ends while a page is open", () => {
  it("re-reads the session after auth.unauthenticated and goes to sign-in, keeping the page", async () => {
    const backend = signedIn();
    const app = renderApp("/profile", backend);
    await screen.findByLabelText("Name");

    backend.signOutEverywhere();
    type("Name", "Someone");
    click("Save");

    await waitForLocation(app, "/sign-in?redirect=%2Fprofile");
    expect(screen.queryByText("sam@example.com")).not.toBeInTheDocument();
  });
});

function withUsers(count: number) {
  const backend = signedIn("admin@example.com", "admin");
  for (let index = 0; index < count; index += 1) {
    backend.addUser({
      email: `user${String(index)}@example.com`,
      name: `User ${String(index)}`,
      verified: index % 2 === 0,
    });
  }
  return backend;
}

describe("/admin/users", () => {
  it("lists users for an admin, and loads more", async () => {
    const backend = withUsers(ADMIN_USERS_PAGE_SIZE + 5);
    renderApp("/admin/users", backend);

    expect(await screen.findByRole("heading", { level: 1, name: "Users" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(ADMIN_USERS_PAGE_SIZE + 1);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Name", "Email address", "Role", "Email confirmed", "Status", "Joined"]);

    click("Load more");

    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(ADMIN_USERS_PAGE_SIZE + 7);
    });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    const requests = backend.calls("/rpc").map((call) => call.body as { payload: unknown });
    expect(requests.map((request) => request.payload)).toEqual([
      { limit: ADMIN_USERS_PAGE_SIZE },
      { limit: ADMIN_USERS_PAGE_SIZE, cursor: String(ADMIN_USERS_PAGE_SIZE) },
    ]);
  });

  it("never shows the old name after the admin saved their own", async () => {
    const app = renderApp("/admin/users", signedIn("admin@example.com", "admin"));
    expect(await screen.findByRole("cell", { name: "Sam" })).toBeInTheDocument();
    await act(() => app.router.navigate({ to: "/profile" }));
    await screen.findByLabelText("Name");

    type("Name", "Sam Renamed");
    click("Save");
    await screen.findByText("Your name is saved.");
    await act(() => app.router.navigate({ to: "/admin/users" }));

    expect(screen.queryByRole("cell", { name: "Sam" })).not.toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Sam Renamed" })).toBeInTheDocument();
  });

  it("drops the rows and the Users link when a demoted admin's next page is refused", async () => {
    const backend = withUsers(ADMIN_USERS_PAGE_SIZE + 5);
    renderApp("/admin/users", backend);
    await screen.findByRole("table");
    const admin = backend.users.get("admin@example.com");
    if (admin === undefined) throw new Error("no user");

    admin.role = "user";
    click("Load more");

    expect(
      await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation")).queryByRole("link", { name: "Users" }),
    ).not.toBeInTheDocument();
  });

  it("shows a signed-in non-admin a not-allowed page, not a redirect, and asks for nothing", async () => {
    const app = renderApp("/admin/users", signedIn());

    expect(
      await screen.findByRole("heading", { level: 1, name: "You do not have access to this page" }),
    ).toBeInTheDocument();
    expect(app.location()).toBe("/admin/users");
    expect(app.backend.calls("/rpc")).toEqual([]);
  });

  it("sends a signed-out visitor to sign-in", async () => {
    const app = renderApp("/admin/users", createFakeBackend());

    await waitForLocation(app, "/sign-in?redirect=%2Fadmin%2Fusers");
  });
});

describe("unknown paths", () => {
  it("show a not-found page", async () => {
    renderApp("/nowhere", createFakeBackend());

    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
