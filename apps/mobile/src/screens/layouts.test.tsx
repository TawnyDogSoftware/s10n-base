import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createBackend, createTestServices, press, renderScreen, signIn } from "../test/render";
import { SignedInLayout, SignedOutLayout } from "./layouts";

describe("SignedInLayout", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    renderScreen(<SignedInLayout />);

    expect(await screen.findByTestId("redirect")).toHaveTextContent("/sign-in");
  });

  it("shows the signed-in screens to a signed-in user", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    const services = createTestServices(backend);
    await signIn(services, "sam@example.com");

    renderScreen(<SignedInLayout />, { backend, services });

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("leaves as soon as the session ends while a screen is open", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    const services = createTestServices(backend);
    await signIn(services, "sam@example.com");
    renderScreen(<SignedInLayout />, { backend, services });
    await act(() => services.gate.ensure());

    backend.signOutEverywhere();
    await act(() => services.gate.refresh());

    expect(await screen.findByTestId("redirect")).toHaveTextContent("/sign-in");
  });

  it("offers a retry when the server cannot be reached, instead of guessing", async () => {
    const backend = createBackend();
    backend.failNext("/api/app-auth/session", { kind: "network" });

    renderScreen(<SignedInLayout />, { backend });

    expect(await screen.findByText("We could not reach the server")).toBeInTheDocument();
    // In a scroll view, so large text can still reach the retry.
    expect(screen.getByTestId("start-error")).toContainElement(
      screen.getByText("We could not reach the server"),
    );
    expect(screen.queryByTestId("redirect")).toBeNull();
    press("Try again");
    expect(await screen.findByTestId("redirect")).toHaveTextContent("/sign-in");
  });
});

describe("SignedOutLayout", () => {
  it("sends a signed-in user home", async () => {
    const backend = createBackend();
    backend.addUser({ email: "sam@example.com" });
    const services = createTestServices(backend);
    await signIn(services, "sam@example.com");

    renderScreen(<SignedOutLayout />, { backend, services });

    expect(await screen.findByTestId("redirect")).toHaveTextContent("/");
  });

  it("shows the sign-in screens to a visitor", async () => {
    renderScreen(<SignedOutLayout />);

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
});
