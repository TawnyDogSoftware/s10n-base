import { onlineManager } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { appVariants } from "@s10n-base/shared/app-variants";

import { locales, setNetwork } from "../test/native";
import { createRoot, RootLayout } from "./root";

describe("createRoot", () => {
  it("builds the services from the build's config, with the variant's scheme", () => {
    const root = createRoot(
      { extra: { appVariant: "preview", apiBaseUrl: "https://api.example.com" } },
      [{ languageTag: "en-GB" }],
    );

    expect(root.services.rpc.baseUrl).toBe("https://api.example.com");
    expect(root.scheme).toBe(appVariants.preview.urlScheme);
    expect(root.i18n.language).toBe("en");
  });

  it("refuses a build without its config", () => {
    expect(() => createRoot(null, [])).toThrow("This build's configuration is invalid");
  });
});

describe("RootLayout", () => {
  it("renders, and connects TanStack Query to the network state while mounted", async () => {
    locales.splice(0, locales.length, { languageTag: "en-US" });
    const { unmount } = render(<RootLayout />);

    setNetwork({ isConnected: false });
    await waitFor(() => expect(onlineManager.isOnline()).toBe(false));

    unmount();
    expect(onlineManager.isOnline()).toBe(true);
  });
});
