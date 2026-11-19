import { focusManager, onlineManager } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AppState, type AppStateStatus, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionGateProvider } from "@s10n-base/client/query-state";
import { useSession } from "@s10n-base/client/session";
import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { setNetwork } from "../test/native";
import { createServices } from "../services";
import { connectQueryLifecycle, isOffline } from "./query-lifecycle";

const API = "http://localhost:4210";

/** Captures the AppState listener the lifecycle registers, so a test can drive it. */
function captureAppState() {
  const listeners: Array<(state: AppStateStatus) => void> = [];
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => listeners.splice(listeners.indexOf(listener as never), 1) };
  });
  return (state: AppStateStatus) => {
    act(() => {
      for (const listener of listeners) listener(state);
    });
  };
}

function SessionName() {
  const session = useSession();
  return <Text>{session === undefined ? "loading" : (session?.name ?? "signed out")}</Text>;
}

let disconnect: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe("isOffline", () => {
  it("is offline only when the platform says so; unknown counts as online", () => {
    expect(isOffline({ isConnected: false })).toBe(true);
    expect(isOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(isOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
    expect(isOffline({})).toBe(false);
  });
});

describe("connectQueryLifecycle", () => {
  it("re-reads the session when the app returns to the foreground, and notices a revoked one", async () => {
    const appState = captureAppState();
    disconnect = connectQueryLifecycle();
    const backend = createFakeBackend({ origin: API, cookies: true });
    backend.addUser({ email: "sam@example.com", name: "Sam" });
    const services = createServices({ apiBaseUrl: API, scheme: "test", fetch: backend.fetch });
    await services.auth.signIn({ email: "sam@example.com", password: "correct horse" });

    render(
      <SessionGateProvider gate={services.gate}>
        <SessionName />
      </SessionGateProvider>,
    );
    expect(await screen.findByText("Sam")).toBeInTheDocument();
    const reads = () => backend.calls("/api/app-auth/session").length;
    expect(reads()).toBe(1);

    // Signed out on another device while this app was in the background.
    appState("background");
    backend.signOutEverywhere();
    vi.setSystemTime(Date.now() + 60_000);
    appState("active");

    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(reads()).toBe(2);
  });

  it("does not re-read a fresh session on every return to the foreground", async () => {
    const appState = captureAppState();
    disconnect = connectQueryLifecycle();
    const backend = createFakeBackend({ origin: API, cookies: true });
    const services = createServices({ apiBaseUrl: API, scheme: "test", fetch: backend.fetch });

    render(
      <SessionGateProvider gate={services.gate}>
        <SessionName />
      </SessionGateProvider>,
    );
    expect(await screen.findByText("signed out")).toBeInTheDocument();

    appState("background");
    appState("active");

    expect(focusManager.isFocused()).toBe(true);
    expect(backend.calls("/api/app-auth/session")).toHaveLength(1);
  });

  it("tells TanStack Query when the phone goes offline and back", async () => {
    disconnect = connectQueryLifecycle();

    setNetwork({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    setNetwork({ isConnected: true, isInternetReachable: true });
    await waitFor(() => expect(onlineManager.isOnline()).toBe(true));
  });

  it("stops listening when disconnected", () => {
    const appState = captureAppState();
    connectQueryLifecycle()();

    appState("background");
    setNetwork({ isConnected: false });

    expect(onlineManager.isOnline()).toBe(true);
  });
});
