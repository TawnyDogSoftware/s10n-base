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

const UPDATE = "/api/auth/passkey/update-passkey";

/** The profile page of a user with a named and an unnamed passkey. */
async function withPasskeys() {
  const backend = signedIn();
  const sam = backend.users.get("sam@example.com");
  if (sam === undefined) throw new Error("no user");
  sam.passkeys = [
    { id: "pk1", name: "Laptop", createdAt: "2026-11-01T10:00:00.000Z" },
    { id: "pk2", name: null, createdAt: "2026-11-02T10:00:00.000Z" },
  ];
  renderApp("/profile", backend);
  await screen.findByText("Laptop");
  return { backend, sam };
}

/** Opens the form of the passkey named Laptop and returns its field. */
function openLaptop() {
  click(/^Rename passkey Laptop, added /);
  return screen.getByLabelText("Passkey name");
}

/** Presses a button of the open form, which shares its "Save" with the name form. */
function pressInForm(name: string) {
  const form = screen.getByLabelText("Passkey name").closest("form");
  if (form === null) throw new Error("no form");
  fireEvent.click(within(form).getByRole("button", { name }));
}

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
    click(/^Remove passkey Laptop, added /);

    expect(await screen.findByText("Passkey removed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Laptop")).not.toBeInTheDocument());
    expect(backend.calls("/api/auth/passkey/list-user-passkeys").length).toBeGreaterThanOrEqual(2);
  });

  describe("renaming a passkey", () => {
    it("saves the new name, reads the list again and returns focus to the row", async () => {
      const { backend } = await withPasskeys();

      const field = openLaptop();
      expect(field).toHaveValue("Laptop");
      expect(field).toHaveFocus();
      type("Passkey name", "  Work laptop ");
      pressInForm("Save");

      expect(await screen.findByText("Passkey renamed.")).toBeInTheDocument();
      expect(screen.getByText("Work laptop")).toBeInTheDocument();
      expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
      expect(backend.calls(UPDATE).map((call) => call.body)).toEqual([
        { id: "pk1", name: "Work laptop" },
      ]);
      expect(backend.calls("/api/auth/passkey/list-user-passkeys").length).toBeGreaterThanOrEqual(
        2,
      );
      expect(screen.queryByLabelText("Passkey name")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /^Rename passkey Work laptop, added / }),
        ).toHaveFocus();
      });
    });

    it("shows a name's error on the field, focuses it, and sends nothing", async () => {
      const { backend } = await withPasskeys();
      const field = openLaptop();

      type("Passkey name", "   ");
      screen.getByLabelText("Name").focus();
      pressInForm("Save");
      await waitFor(() => {
        expect(field).toHaveAccessibleDescription("Enter a name for the passkey.");
      });
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveFocus();

      type("Passkey name", "x".repeat(101));
      pressInForm("Save");
      await waitFor(() => {
        expect(field).toHaveAccessibleDescription("Use at most 100 characters.");
      });

      type("Passkey name", "Lap\u0000top");
      pressInForm("Save");
      await waitFor(() => {
        expect(field).toHaveAccessibleDescription(
          "The name contains a character that cannot be used: U+0000. Please try another name.",
        );
      });
      expect(backend.calls(UPDATE)).toEqual([]);
    });

    it("sends nothing on Cancel or for an unchanged name, and returns focus", async () => {
      const { backend } = await withPasskeys();

      // An unnamed passkey's field starts empty.
      click(/^Rename passkey Passkey, added /);
      expect(screen.getByLabelText("Passkey name")).toHaveValue("");
      type("Passkey name", "Phone");
      pressInForm("Cancel");
      expect(screen.queryByLabelText("Passkey name")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /^Rename passkey Passkey, added / }),
        ).toHaveFocus();
      });

      openLaptop();
      type("Passkey name", " Laptop ");
      pressInForm("Save");
      expect(screen.queryByLabelText("Passkey name")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /^Rename passkey Laptop, added / }),
        ).toHaveFocus();
      });
      expect(backend.calls(UPDATE)).toEqual([]);
      expect(screen.queryByText("Passkey renamed.")).not.toBeInTheDocument();
    });

    it("edits one passkey at a time", async () => {
      await withPasskeys();

      openLaptop();
      click(/^Rename passkey Passkey, added /);

      expect(screen.getAllByLabelText("Passkey name")).toHaveLength(1);
      expect(screen.getByLabelText("Passkey name")).toHaveValue("");
      expect(screen.getByText("Laptop")).toBeInTheDocument();
    });

    it("shows the refusal and the list as it is when the passkey was removed elsewhere", async () => {
      const { backend, sam } = await withPasskeys();
      openLaptop();
      type("Passkey name", "Work laptop");
      sam.passkeys = sam.passkeys.filter((passkey) => passkey.id !== "pk1");

      pressInForm("Save");

      expect(await screen.findByText("That passkey no longer exists.")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByLabelText("Passkey name")).not.toBeInTheDocument());
      expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
      expect(backend.calls(UPDATE)).toHaveLength(1);
    });

    it("keeps the form open when the server refuses the name", async () => {
      const { backend } = await withPasskeys();
      openLaptop();
      type("Passkey name", "Work laptop");
      backend.failNext(UPDATE, {
        kind: "response",
        status: 400,
        body: { code: "INVALID_NAME", message: "The name is not valid." },
      });

      pressInForm("Save");

      expect(
        await screen.findByText("That name cannot be used. Please try another name."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Passkey name")).toHaveValue("Work laptop");
    });

    it("says the outcome is unknown when the answer is lost, and shows the list as the server has it", async () => {
      const { backend } = await withPasskeys();
      openLaptop();
      type("Passkey name", "Work laptop");
      backend.failNext(UPDATE, { kind: "network", afterHandling: true });

      pressInForm("Save");

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("We could not confirm whether that worked");
      expect(alert).toHaveTextContent("You are still signed in.");
      // The list read afterwards is the truth: the passkey was renamed.
      expect(await screen.findByText("Work laptop")).toBeInTheDocument();
      expect(screen.queryByLabelText("Passkey name")).not.toBeInTheDocument();
    });

    it("gives two passkeys with the same name and date different rename buttons", async () => {
      const backend = signedIn();
      const sam = backend.users.get("sam@example.com");
      if (sam === undefined) throw new Error("no user");
      sam.passkeys = [
        { id: "pk1", name: "Key", createdAt: "2026-11-20T14:40:00.000Z" },
        { id: "pk2", name: "Key", createdAt: "2026-11-20T14:40:00.000Z" },
      ];
      renderApp("/profile", backend);

      const buttons = await screen.findAllByRole("button", { name: /^Rename passkey Key, added / });
      expect(buttons).toHaveLength(2);
      expect(new Set(buttons.map((button) => button.getAttribute("aria-label"))).size).toBe(2);
    });

    it("disables the other buttons while it saves, and ignores a second submit", async () => {
      vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
      const { backend } = await withPasskeys();
      const field = openLaptop();
      type("Passkey name", "Work laptop");
      const release = backend.hold(UPDATE);

      pressInForm("Save");

      expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add a passkey" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /^Rename passkey Passkey, added / }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: /^Remove passkey Passkey, added / }),
      ).toBeDisabled();
      const form = field.closest("form");
      if (form === null) throw new Error("no form");
      fireEvent.submit(form);
      // The second submit neither sends anything nor ends the first one's pending state.
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      release();

      expect(await screen.findByText("Passkey renamed.")).toBeInTheDocument();
      expect(backend.calls(UPDATE)).toHaveLength(1);
    });
  });

  it("tells apart two passkeys added the same day, on screen and to a screen reader", async () => {
    const backend = signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.passkeys = [
      { id: "pk1", name: null, createdAt: "2026-11-20T09:05:00.000Z" },
      { id: "pk2", name: null, createdAt: "2026-11-20T14:40:00.000Z" },
      { id: "pk3", name: null, createdAt: "2026-11-20T14:40:00.000Z" },
    ];
    renderApp("/profile", backend);

    const buttons = await screen.findAllByRole("button", { name: /^Remove passkey/ });
    const rows = buttons.map((button) => button.closest("li")?.textContent);
    expect(new Set(rows.slice(0, 2)).size).toBe(2);
    expect(new Set(buttons.map((button) => button.getAttribute("aria-label"))).size).toBe(3);
  });

  it("names a new passkey when it is added", async () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    const app = renderApp("/profile", signedIn());

    await screen.findByRole("button", { name: "Add a passkey" });
    click("Add a passkey");

    await waitFor(() => {
      expect(app.backend.calls("/api/auth/passkey/generate-register-options")).toHaveLength(1);
    });
    expect(
      new URLSearchParams(
        app.backend.calls("/api/auth/passkey/generate-register-options")[0]?.search,
      ).get("name"),
    ).toMatch(/^Passkey added /);
  });

  it("says which passkey is being removed, and not that a device is awaited", async () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    const backend = signedIn();
    const sam = backend.users.get("sam@example.com");
    if (sam === undefined) throw new Error("no user");
    sam.passkeys = [
      { id: "pk1", name: "Laptop", createdAt: "2026-11-01T10:00:00.000Z" },
      { id: "pk2", name: "Phone", createdAt: "2026-11-02T10:00:00.000Z" },
    ];
    renderApp("/profile", backend);
    await screen.findByText("Laptop");
    const release = backend.hold("/api/auth/passkey/delete-passkey");

    click(/^Remove passkey Laptop, added /);

    expect(await screen.findByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.queryByText("Waiting for your device…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a passkey" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Remove passkey Phone/ })).toBeDisabled();
    release();
    expect(await screen.findByText("Passkey removed.")).toBeInTheDocument();
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

    click(/^Remove passkey Laptop, added /);

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

  it("keeps the list and says so when reading it again fails, with a retry", async () => {
    const backend = withUsers(3);
    const app = renderApp("/admin/users", backend);
    await screen.findByRole("cell", { name: "User 0" });
    backend.failNext("/rpc", { kind: "network" });

    await act(() => app.services.gate.queryClient.refetchQueries({ queryKey: ["user"] }));

    expect(await screen.findByText("We could not refresh the list.")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "User 0" })).toBeInTheDocument();
    click("Try again");
    await waitFor(() => {
      expect(screen.queryByText("We could not refresh the list.")).not.toBeInTheDocument();
    });
  });

  it("lets a long unbroken name wrap instead of widening the page", async () => {
    const backend = withUsers(1);
    backend.addUser({ email: "long@example.com", name: "x".repeat(100) });
    renderApp("/admin/users", backend);

    expect(await screen.findByRole("cell", { name: "x".repeat(100) })).toHaveClass("wrap-anywhere");
    expect(screen.getByRole("cell", { name: "long@example.com" })).toHaveClass("wrap-anywhere");
  });

  it("makes the scrolling table reachable and named for the keyboard", async () => {
    renderApp("/admin/users", withUsers(1));

    const region = await screen.findByRole("region", { name: "Users" });

    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("keeps focus on Load more while it loads, then moves it to the first new row", async () => {
    const backend = withUsers(ADMIN_USERS_PAGE_SIZE + 5);
    renderApp("/admin/users", backend);
    const table = await screen.findByRole("table");
    const button = screen.getByRole("button", { name: "Load more" });
    button.focus();
    const release = backend.hold("/rpc");

    click("Load more");

    const loading = await screen.findByRole("button", { name: "Loading more…" });
    expect(loading).not.toBeDisabled();
    expect(loading).toHaveAttribute("aria-disabled", "true");
    expect(loading).toHaveFocus();
    release();
    await waitFor(() => {
      expect(within(table).getAllByRole("row")).toHaveLength(ADMIN_USERS_PAGE_SIZE + 7);
    });
    await waitFor(() => {
      expect(within(table).getAllByRole("row")[ADMIN_USERS_PAGE_SIZE + 1]).toHaveFocus();
    });
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
