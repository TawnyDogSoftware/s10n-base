import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { DecodeError } from "./rpc";
import {
  createSessionClient,
  SESSION_QUERY_KEY,
  SessionClientProvider,
  sessionQueryOptions,
  useSession,
} from "./session";
import { fakeFetch, json } from "./test-fetch";

const session = {
  userId: "user-a",
  email: "a@example.com",
  name: "A",
  image: null,
  role: "user",
  emailVerified: true,
  expiresAt: "2026-11-28T12:00:00.000Z",
} as const;

describe("createSessionClient", () => {
  it("reads GET <baseUrl>/api/app-auth/session with credentials", async () => {
    const { fetch, requests } = fakeFetch(() => json({ ok: true, data: { session } }));
    const client = createSessionClient({ baseUrl: "https://api.example.com", fetch });

    await expect(client.fetchSession()).resolves.toEqual(session);
    expect(requests).toMatchObject([
      {
        url: "https://api.example.com/api/app-auth/session",
        method: "GET",
        credentials: "include",
      },
    ]);
  });

  it("returns null when signed out", async () => {
    const { fetch } = fakeFetch(() => json({ ok: true, data: { session: null } }));

    await expect(
      createSessionClient({ baseUrl: "https://api.example.com", fetch }).fetchSession(),
    ).resolves.toBeNull();
  });

  it("throws a DecodeError for a session the contract rejects", async () => {
    const { fetch } = fakeFetch(() =>
      json({ ok: true, data: { session: { ...session, role: "owner" } } }),
    );

    await expect(
      createSessionClient({ baseUrl: "https://api.example.com", fetch }).fetchSession(),
    ).rejects.toBeInstanceOf(DecodeError);
  });
});

describe("sessionQueryOptions", () => {
  it("is public, runs offline too, and does not retry", () => {
    const options = sessionQueryOptions({ fetchSession: () => Promise.resolve(null) });

    expect(options.queryKey).toEqual(SESSION_QUERY_KEY);
    expect(options.meta).toEqual({ public: true });
    expect(options.networkMode).toBe("always");
    expect(options.retry).toBe(false);
  });
});

describe("useSession", () => {
  it("returns undefined while loading, then the session", async () => {
    const queryClient = new QueryClient();
    const client = { fetchSession: () => Promise.resolve(session) };
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SessionClientProvider client={client}>{children}</SessionClientProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useSession(), { wrapper });

    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current).toEqual(session);
    });
  });

  it("fails loudly outside a SessionClientProvider", () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    expect(() => renderHook(() => useSession(), { wrapper })).toThrow(/SessionClientProvider/);
  });
});
