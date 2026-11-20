import { onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSession } from "@s10n-base/contracts";

import {
  browserSessionChannel,
  createSessionGate,
  type SessionChannel,
  SessionGateProvider,
  StaleSessionError,
  useProtectedQuery,
  useSessionGate,
  type SessionGate,
} from "./query-state";
import { NetworkError, RpcError } from "./rpc";
import { SESSION_QUERY_KEY, type SessionClient } from "./session";
import { deferred } from "./test-fetch";

function user(id: string, role: AppSession["role"] = "user"): AppSession {
  return {
    userId: id,
    email: `${id}@example.com`,
    name: id,
    image: null,
    role,
    emailVerified: true,
  };
}

const alice = user("alice");
const bob = user("bob");

/** A session client whose answer the test controls. */
function controllableSession(initial: AppSession | null) {
  let current: AppSession | null = initial;
  const fetchSession = vi.fn<SessionClient["fetchSession"]>(() => Promise.resolve(current));
  return {
    client: { fetchSession },
    fetchSession,
    set(next: AppSession | null) {
      current = next;
    },
  };
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setup(initial: AppSession | null = alice) {
  const queryClient = newQueryClient();
  const server = controllableSession(initial);
  const gate = createSessionGate({ queryClient, sessionClient: server.client });
  return { queryClient, server, gate };
}

/** Accepts a session the way a fetch would: through the session query. */
function accept(gate: SessionGate, session: AppSession | null) {
  gate.queryClient.setQueryData(SESSION_QUERY_KEY, session);
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

const fetcher = () => Promise.resolve("x");

describe("protected queries", () => {
  it("put the signed-in user's id in the key, and are disabled without a session", () => {
    const { gate } = setup();

    expect(gate.protectedQueryOptions(alice, ["profile"], fetcher)).toMatchObject({
      queryKey: ["user", "alice", "profile"],
      enabled: true,
    });
    expect(gate.protectedQueryOptions(null, ["profile"], fetcher)).toMatchObject({
      queryKey: ["user", null, "profile"],
      enabled: false,
    });
    expect(gate.protectedQueryOptions(undefined, ["profile"], fetcher)).toMatchObject({
      enabled: false,
    });
  });

  it("never let a component rendering for one user read another user's data", async () => {
    const { gate } = setup();
    accept(gate, alice);
    const answers = new Map([
      ["alice", deferred<string>()],
      ["bob", deferred<string>()],
    ]);
    const renders: Array<readonly [string | undefined, string | undefined]> = [];

    function Profile() {
      const { session, query } = useProtectedQuery(["profile"], () => {
        const userId = gate.current()?.userId ?? "";
        return answers.get(userId)?.promise ?? Promise.reject(new Error("no answer"));
      });
      renders.push([session?.userId, query.data]);
      return <p>{query.data ?? "loading"}</p>;
    }

    render(
      <SessionGateProvider gate={gate}>
        <Profile />
      </SessionGateProvider>,
    );
    act(() => {
      answers.get("alice")?.resolve("alice's profile");
    });
    await screen.findByText("alice's profile");

    act(() => {
      accept(gate, bob);
    });
    await screen.findByText("loading");
    act(() => {
      answers.get("bob")?.resolve("bob's profile");
    });
    await screen.findByText("bob's profile");

    expect(renders).toContainEqual(["alice", "alice's profile"]);
    expect(renders).toContainEqual(["bob", "bob's profile"]);
    expect(renders.filter(([who, data]) => who === "bob" && data === "alice's profile")).toEqual(
      [],
    );
  });
});

describe("when the signed-in user changes", () => {
  it("cancels in-flight queries, then removes every query and mutation not marked public", async () => {
    const { gate, queryClient } = setup();
    accept(gate, alice);
    queryClient.setQueryData(["user", "alice", "profile"], "alice's profile");
    queryClient.setQueryData(["plain"], "not marked");
    queryClient.setQueryDefaults(["config"], { meta: { public: true } });
    queryClient.setQueryData(["config"], "public");
    let signal: AbortSignal | undefined;
    const inFlight = queryClient
      .query({
        queryKey: ["user", "alice", "slow"],
        queryFn: ({ signal: querySignal }) => {
          signal = querySignal;
          return new Promise<string>(() => {});
        },
      })
      .catch((error: unknown) => error);
    const mutationCache = queryClient.getMutationCache();
    mutationCache.build(queryClient, { mutationFn: () => Promise.resolve(), meta: {} });
    mutationCache.build(queryClient, {
      mutationFn: () => Promise.resolve(),
      meta: { public: true },
    });

    accept(gate, bob);

    // Synchronously, in the same call that installed the new session.
    expect(signal?.aborted).toBe(true);
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBeUndefined();
    expect(queryClient.getQueryData(["plain"])).toBeUndefined();
    expect(queryClient.getQueryData(["config"])).toBe("public");
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(bob);
    expect(mutationCache.getAll().map((mutation) => mutation.meta)).toEqual([{ public: true }]);
    await inFlight;
  });

  it("purges on sign-out and on a role change, but not when the same user is read again", () => {
    const { gate, queryClient } = setup();
    accept(gate, alice);
    const epoch = gate.epoch();

    accept(gate, { ...alice, name: "Alice Renamed" });
    queryClient.setQueryData(["user", "alice", "profile"], "kept");
    expect(gate.epoch()).toBe(epoch);
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBe("kept");

    accept(gate, { ...alice, role: "admin" });
    expect(gate.epoch()).toBe(epoch + 1);
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBeUndefined();

    queryClient.setQueryData(["user", "alice", "profile"], "again");
    accept(gate, null);
    expect(gate.epoch()).toBe(epoch + 2);
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBeUndefined();
    expect(gate.current()).toBeNull();
  });

  it("does not purge on the first session it sees", () => {
    const { gate, queryClient } = setup();
    queryClient.setQueryData(["plain"], "kept");

    accept(gate, alice);

    expect(queryClient.getQueryData(["plain"])).toBe("kept");
    expect(gate.current()).toEqual(alice);
  });
});

describe("a response that started under one user and finished under another", () => {
  it("is discarded from a protected query: the slow answer for alice never reaches the cache", async () => {
    const { gate, queryClient } = setup();
    accept(gate, alice);
    const slow = deferred<string>();
    const options = gate.protectedQueryOptions(alice, ["profile"], () => slow.promise);
    // The query function itself, as a retry or a caller outside the cache would run it.
    const run = options.queryFn({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: queryClient,
    });

    accept(gate, bob);
    slow.resolve("alice's profile");

    await expect(run).rejects.toBeInstanceOf(StaleSessionError);
    for (const query of queryClient.getQueryCache().getAll()) {
      expect(query.state.data).not.toBe("alice's profile");
    }
  });

  it("is discarded from a guarded call, such as a mutation", async () => {
    const { gate } = setup();
    accept(gate, alice);
    const slow = deferred<string>();

    const result = gate.guard(() => slow.promise);
    accept(gate, bob);
    slow.resolve("saved for alice");

    await expect(result).rejects.toBeInstanceOf(StaleSessionError);
  });

  it("is discarded from a guarded call that failed after the user changed", async () => {
    const { gate } = setup();
    accept(gate, alice);
    const slow = deferred<string>();

    const result = gate.guard(() => slow.promise);
    accept(gate, bob);
    slow.reject(new Error("failed for alice"));

    await expect(result).rejects.toBeInstanceOf(StaleSessionError);
  });

  it("is kept when the user did not change", async () => {
    const { gate } = setup();
    accept(gate, alice);

    await expect(gate.guard(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("an auth.unauthenticated error from a protected call", () => {
  it("re-reads the session, and a session that is gone is a sign-out transition", async () => {
    const { gate, queryClient, server } = setup();
    accept(gate, alice);
    queryClient.setQueryData(["user", "alice", "profile"], "alice's profile");
    server.set(null);
    server.fetchSession.mockClear();

    await expect(
      gate.guard(() => Promise.reject(new RpcError("auth.unauthenticated", "Sign in.", 401))),
    ).rejects.toBeInstanceOf(RpcError);

    await waitFor(() => {
      expect(gate.current()).toBeNull();
    });
    expect(server.fetchSession).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBeUndefined();
  });

  it("re-reads the session from a protected query too", async () => {
    const { gate, server } = setup();
    accept(gate, alice);
    server.set(null);
    server.fetchSession.mockClear();
    const options = gate.protectedQueryOptions(alice, ["profile"], () =>
      Promise.reject(new RpcError("auth.unauthenticated", "Sign in.", 401)),
    );

    await expect(gate.queryClient.query(options)).rejects.toBeInstanceOf(RpcError);

    await waitFor(() => {
      expect(gate.current()).toBeNull();
    });
    expect(server.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("does not re-read the session for other errors", async () => {
    const { gate, server } = setup();
    accept(gate, alice);
    server.fetchSession.mockClear();

    await expect(
      gate.guard(() => Promise.reject(new RpcError("auth.forbidden", "No.", 403))),
    ).rejects.toBeInstanceOf(RpcError);

    expect(server.fetchSession).not.toHaveBeenCalled();
  });
});

describe("security actions", () => {
  it("re-read the session after success", async () => {
    const { gate, server } = setup(null);
    accept(gate, null);
    server.set(alice);

    const result = await gate.settle(() => Promise.resolve("signed in"));

    expect(result).toEqual({ kind: "done", value: "signed in", session: alice });
    expect(gate.current()).toEqual(alice);
  });

  it("re-read the session after a NetworkError instead of assuming failure", async () => {
    const { gate, server } = setup(null);
    accept(gate, null);
    // The sign-in reached the server; only its answer was lost.
    server.set(alice);

    const result = await gate.settle(() => Promise.reject(new NetworkError("lost")));

    expect(result).toEqual({ kind: "unknown", session: alice });
    expect(gate.current()).toEqual(alice);
  });

  it("re-read the session even when the browser reports offline", async () => {
    const { gate, server } = setup(alice);
    accept(gate, alice);
    onlineManager.setOnline(false);
    server.set(null);
    server.fetchSession.mockClear();

    const result = await gate.settle(() => Promise.reject(new NetworkError("offline")));

    expect(server.fetchSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "unknown", session: null });
    expect(gate.current()).toBeNull();
  });

  it("report the session as unknown when the re-read fails too", async () => {
    const { gate, server } = setup(alice);
    accept(gate, alice);
    server.fetchSession.mockImplementation(() => Promise.reject(new NetworkError("down")));

    const result = await gate.settle(() => Promise.reject(new NetworkError("lost")));

    expect(result).toEqual({ kind: "unknown", session: undefined });
    // Nothing is assumed: the last accepted session stays until the server says otherwise.
    expect(gate.current()).toEqual(alice);
  });

  it("pass other errors through, after re-reading the session", async () => {
    const { gate, server } = setup(alice);
    accept(gate, alice);
    server.fetchSession.mockClear();
    const refused = new RpcError("auth.forbidden", "No.", 403);

    await expect(gate.settle(() => Promise.reject(refused))).rejects.toBe(refused);
    expect(server.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("do not let a session read that started before the action answer for after it", async () => {
    const { gate, server } = setup(null);
    accept(gate, null);
    const early = deferred<AppSession | null>();
    server.fetchSession.mockImplementationOnce(() => early.promise);
    const earlyRead = gate.queryClient
      .query({ ...gate.sessionQueryOptions(), staleTime: 0 })
      .catch(() => undefined);
    server.set(alice);

    const result = await gate.settle(() => Promise.resolve("signed in"));
    early.resolve(null);
    await earlyRead;

    expect(result).toMatchObject({ session: alice });
    expect(gate.current()).toEqual(alice);
  });
});

/** Endpoints of one in-memory channel; like a BroadcastChannel, a post reaches the others only. */
function sharedChannel() {
  const endpoints = new Set<Set<() => void>>();
  return (): SessionChannel => {
    const own = new Set<() => void>();
    endpoints.add(own);
    return {
      post: () => {
        for (const listeners of endpoints) {
          if (listeners === own) continue;
          for (const listener of listeners) queueMicrotask(listener);
        }
      },
      subscribe: (listener) => {
        own.add(listener);
        return () => {
          own.delete(listener);
        };
      },
    };
  };
}

describe("other tabs", () => {
  it("re-read the session when one tab sees the user change", async () => {
    const server = controllableSession(alice);
    const endpoint = sharedChannel();
    const tabA = createSessionGate({
      queryClient: newQueryClient(),
      sessionClient: server.client,
      channel: endpoint(),
    });
    const tabB = createSessionGate({
      queryClient: newQueryClient(),
      sessionClient: server.client,
      channel: endpoint(),
    });
    await tabA.refresh();
    await tabB.refresh();

    // Tab B signs out and in as Bob; tab A has not read the session since.
    server.set(bob);
    await tabB.refresh();

    await waitFor(() => {
      expect(tabA.current()).toEqual(bob);
    });
    // Tab A's own change makes tab B read once more, which changes nothing there: no loop.
    await waitFor(() => {
      expect(server.fetchSession).toHaveBeenCalledTimes(5);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.fetchSession).toHaveBeenCalledTimes(5);
    tabA.dispose();
    tabB.dispose();
  });

  it("are not told when the same user is read again", async () => {
    const server = controllableSession(alice);
    const channel = {
      post: vi.fn<() => void>(),
      subscribe: vi.fn<SessionChannel["subscribe"]>(() => () => undefined),
    };
    const gate = createSessionGate({
      queryClient: new QueryClient(),
      sessionClient: server.client,
      channel,
    });

    await gate.refresh();
    await gate.refresh();
    expect(channel.post).not.toHaveBeenCalled();
    server.set(null);
    await gate.refresh();
    expect(channel.post).toHaveBeenCalledTimes(1);
  });
});

describe("browserSessionChannel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a post to the other channels of the same name, and stops when unsubscribed", async () => {
    const sender = browserSessionChannel("test.session");
    const receiver = browserSessionChannel("test.session");
    const heard = vi.fn<() => void>();
    const unsubscribe = receiver?.subscribe(heard);

    sender?.post();
    await waitFor(() => {
      expect(heard).toHaveBeenCalledTimes(1);
    });
    unsubscribe?.();
  });

  it("is undefined where the platform has no BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    expect(browserSessionChannel("test.session")).toBeUndefined();
  });
});

describe("confirmSignedOut", () => {
  it("installs signed-out and purges, for a sign-out the server confirmed when the read after it failed", () => {
    const { gate, queryClient } = setup(alice);
    accept(gate, alice);
    queryClient.setQueryData(["user", "alice", "profile"], "alice's profile");

    gate.confirmSignedOut();

    expect(gate.current()).toBeNull();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBeUndefined();
  });
});

describe("ensure", () => {
  it("returns the cached session, or reads it once", async () => {
    const { gate, server } = setup(alice);

    await expect(gate.ensure()).resolves.toEqual(alice);
    await expect(gate.ensure()).resolves.toEqual(alice);
    expect(server.fetchSession).toHaveBeenCalledTimes(1);
  });
});

describe("a gate made over a cache that already holds the session", () => {
  it("does not purge for that session when it is read again", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, alice);
    queryClient.setQueryData(["user", "alice", "profile"], "alice's profile");
    const gate = createSessionGate({
      queryClient,
      sessionClient: controllableSession(alice).client,
    });

    accept(gate, alice);

    expect(queryClient.getQueryData(["user", "alice", "profile"])).toBe("alice's profile");
  });
});

describe("useSessionGate", () => {
  it("needs a SessionGateProvider above it", () => {
    expect(() => renderHook(() => useSessionGate())).toThrow(
      "useSessionGate needs a SessionGateProvider above it.",
    );
  });
});

describe("dispose", () => {
  it("stops watching the session", () => {
    const { gate, queryClient } = setup();
    accept(gate, alice);
    queryClient.setQueryData(["plain"], "kept");

    gate.dispose();
    accept(gate, bob);

    expect(queryClient.getQueryData(["plain"])).toBe("kept");
  });
});
