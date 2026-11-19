import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeBackend } from "@s10n-base/client/testing/fake-backend";

import { mountApp } from "./mount";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("mountApp", () => {
  it("starts the app in #root, in the browser's language, against the page's own origin", async () => {
    const backend = createFakeBackend({ origin: window.location.origin });
    vi.stubGlobal("fetch", backend.fetch);
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    act(() => {
      mountApp(window, {});
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(backend.requests[0]?.path).toBe("/api/app-auth/session");
  });

  it("refuses a page without #root", () => {
    vi.stubGlobal("fetch", createFakeBackend({ origin: window.location.origin }).fetch);

    expect(() => {
      mountApp(window, {});
    }).toThrow("index.html has no #root element.");
  });
});
