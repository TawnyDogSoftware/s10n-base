import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "./router";

const bootstrapConfig = {
  appName: "S10N Base",
  appVersion: "9.8.7",
  apiBaseUrl: "http://127.0.0.1:4210",
};

function requestUrl(input: Parameters<typeof fetch>[0]) {
  return typeof input === "string"
    ? input
    : input instanceof Request
      ? input.url
      : input.toString();
}

describe("router", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let releaseConfig: () => void = () => {};

  beforeEach(() => {
    const configReleased = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input) => {
      if (requestUrl(input).endsWith("/config")) {
        await configReleased;
        return new Response(JSON.stringify(bootstrapConfig));
      }
      return new Response("Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderAt(path: string) {
    const router = getRouter(createMemoryHistory({ initialEntries: [path] }));
    render(<RouterProvider router={router} />);
    return router;
  }

  it("renders the home route inside the shell", async () => {
    renderAt("/");

    const header = await screen.findByRole("banner");
    expect(within(header).getByText("S10N Base")).toBeInTheDocument();

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(main).not.toHaveTextContent(/project|note|live|websocket/i);
  });

  it("shows the version once /config resolves", async () => {
    renderAt("/");

    const footer = await screen.findByRole("contentinfo");
    expect(footer).not.toHaveTextContent("9.8.7");

    releaseConfig();

    await waitFor(() => {
      expect(footer).toHaveTextContent("Version 9.8.7");
    });
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual(["/config"]);
  });

  it.each(["/settings", "/projects/x"])(
    "does not render a screen at the removed path %s",
    async (path) => {
      releaseConfig();
      const router = renderAt(path);

      await screen.findByRole("banner");
      await waitFor(() => {
        expect(router.state.status).toBe("idle");
      });

      expect(router.state.matches.map((match) => match.routeId)).toEqual(["__root__"]);
      expect(screen.queryByText(/settings|project detail|notes/i)).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).not.toContain("/rpc");
    },
  );
});
