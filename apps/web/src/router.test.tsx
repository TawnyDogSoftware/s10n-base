import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "./router";

class MockWebSocket {
  static readonly instances: MockWebSocket[] = [];
  readonly url: string;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  close() {}
}

describe("router smoke", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    fetchMock.mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();

      if (url.endsWith("/config")) {
        return new Response(
          JSON.stringify({
            appName: "S10N Base",
            appVersion: "0.0.0",
            apiBaseUrl: "http://127.0.0.1:4210",
            websocketUrl: "ws://127.0.0.1:4210/ws",
            desktopHost: false,
          }),
        );
      }

      if (url.endsWith("/rpc")) {
        const body = JSON.parse(String(init?.body)) as { method: string };

        if (body.method === "projects.list") {
          return new Response(JSON.stringify({ ok: true, data: { projects: [] } }));
        }

        if (body.method === "settings.get") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                defaultProjectSort: "updatedAt",
                showActivityFeed: true,
                compactSidebar: false,
                updatedAt: new Date().toISOString(),
              },
            }),
          );
        }
      }

      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the home route inside the shell", async () => {
    const router = getRouter(createMemoryHistory({ initialEntries: ["/"] }));

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeInTheDocument();
    });

    expect(
      screen.getByText("A reusable monorepo scaffold with a typed server boundary."),
    ).toBeInTheDocument();
  });
});
