/**
 * TanStack Query learns about focus and connectivity from browser events, which a native app does
 * not have. This wires its focus manager to `AppState` and its online manager to `expo-network`.
 * Without it the session is never re-read when the app returns to the foreground, so a session
 * revoked elsewhere (signed out on the web, password reset, banned) would go unnoticed.
 */
import { focusManager, onlineManager } from "@tanstack/react-query";
import { addNetworkStateListener } from "expo-network";
import { AppState } from "react-native";

/** Offline only when the platform says so; an unknown state counts as online. */
export function isOffline(state: {
  readonly isConnected?: boolean | undefined;
  readonly isInternetReachable?: boolean | null | undefined;
}): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

/**
 * Connects both managers. Returns a function that disconnects them, leaving TanStack Query
 * focused and online.
 */
export function connectQueryLifecycle(): () => void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) => {
      setFocused(state === "active");
    });
    return () => {
      subscription.remove();
    };
  });
  onlineManager.setEventListener((setOnline) => {
    const subscription = addNetworkStateListener((state) => {
      setOnline(!isOffline(state));
    });
    return () => {
      subscription.remove();
    };
  });
  return () => {
    focusManager.setEventListener(() => undefined);
    onlineManager.setEventListener(() => undefined);
    focusManager.setFocused();
    onlineManager.setOnline(true);
  };
}
