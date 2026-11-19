import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { authStoragePrefix } from "../lib/auth";
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
import { HomeScreen } from "./home";
import { ProfileScreen } from "./profile";
import { ADMIN_USERS_PAGE_SIZE, UsersScreen } from "./users";

async function signedIn(role: "user" | "admin" = "user") {
  const backend = createBackend();
  backend.addUser({ email: "sam@example.com", name: "Sam", role });
  const services = createTestServices(backend);
  await signIn(services, "sam@example.com");
  return { backend, services };
}

describe("HomeScreen", () => {
  it("greets the user and links to the profile", async () => {
    renderScreen(<HomeScreen />, await signedIn());

    expect(await screen.findByRole("heading", { name: "Hello, Sam" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all users" })).toBeNull();
    screen.getByRole("link", { name: "Edit your profile" }).click();
    expect(router.push).toHaveBeenCalledWith("/profile");
  });

  it("links an admin to the user list", async () => {
    renderScreen(<HomeScreen />, await signedIn("admin"));

    (await screen.findByRole("link", { name: "See all users" })).click();
    expect(router.push).toHaveBeenCalledWith("/users");
  });
});

describe("ProfileScreen", () => {
  it("shows the email and its state, and saves a new name the session then shows", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<ProfileScreen />, { backend, services });

    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/passkey/i)).toBeNull();

    type("Name", "  Samantha ");
    press("Save");

    expect(await screen.findByText("Your name is saved.")).toBeInTheDocument();
    expect(backend.users.get("sam@example.com")?.name).toBe("Samantha");
    await waitFor(() => {
      expect(services.gate.current()?.name).toBe("Samantha");
    });
  });

  it("refuses an empty name without sending it", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<ProfileScreen />, { backend, services });
    await screen.findByText("sam@example.com");

    type("Name", "   ");
    press("Save");

    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(backend.calls("/rpc").filter((call) => call.body !== undefined)).toHaveLength(1);
  });

  it("signs out: the cookie is gone and the session reads signed out", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<ProfileScreen />, { backend, services });
    await screen.findByText("sam@example.com");

    press("Sign out");

    await waitFor(() => {
      expect(services.gate.current()).toBeNull();
    });
    expect(backend.liveSessions()).toBe(0);
    expect(secureStore.get(`${authStoragePrefix(API)}_cookie`)).toBe("{}");
  });

  it("signs this device out even when the sign-out's answer is lost", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<ProfileScreen />, { backend, services });
    await screen.findByText("sam@example.com");
    backend.failNext("/api/auth/sign-out", { kind: "network" });

    press("Sign out");

    // The Expo client forgot the cookie before sending, so the read afterwards is signed out.
    await waitFor(() => {
      expect(services.gate.current()).toBeNull();
    });
  });

  it("never shows one user's profile to the next", async () => {
    const { backend, services } = await signedIn();
    backend.addUser({ email: "ada@example.com", name: "Ada" });
    renderScreen(<ProfileScreen />, { backend, services });
    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();

    await act(async () => {
      await services.auth.signOut();
      await signIn(services, "ada@example.com");
      await services.gate.refresh();
    });

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText("sam@example.com")).toBeNull();
    // Sam's profile is gone from the cache, not only from the screen.
    const cached = services.gate.queryClient.getQueryCache().getAll();
    expect(cached.map((query) => JSON.stringify(query.state.data))).not.toContainEqual(
      expect.stringContaining("sam@example.com"),
    );
  });
});

describe("UsersScreen", () => {
  it("tells a signed-in user who is not an admin that the list is not for them", async () => {
    const { backend, services } = await signedIn();
    renderScreen(<UsersScreen />, { backend, services });

    expect(await screen.findByText("You do not have access to this page")).toBeInTheDocument();
    expect(backend.calls("/rpc")).toHaveLength(0);
  });

  it("lists users for an admin, a page at a time", async () => {
    const { backend, services } = await signedIn("admin");
    for (let index = 0; index < ADMIN_USERS_PAGE_SIZE; index += 1) {
      backend.addUser({ email: `user${String(index)}@example.com`, name: `User ${String(index)}` });
    }
    renderScreen(<UsersScreen />, { backend, services });

    expect(await screen.findByText("user24@example.com")).toBeInTheDocument();
    expect(screen.queryByText("sam@example.com")).toBeNull();
    press("Load more");

    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(screen.getAllByText("Role: Admin")).toHaveLength(1);
    expect(screen.getAllByText("Email confirmed: Yes").length).toBeGreaterThan(1);
  });
});
