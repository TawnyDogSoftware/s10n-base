/**
 * Session-gated query state: cached server data belongs to the user who was signed in when it
 * was fetched, and never outlives them. The rules:
 *
 * 1. Protected queries are built by {@link SessionGate.protectedQueryOptions}: the user's id is in
 *    the key and the query is disabled without a session, so a component rendering for one user
 *    cannot read another's data even if a purge were late.
 * 2. When the accepted session's user (or role) changes, including to signed out, in-flight
 *    queries are cancelled and every query and mutation not marked {@link PUBLIC_META} is
 *    removed, synchronously, before React hears of the new session.
 * 3. A response that started under one user and finishes under another is discarded
 *    ({@link StaleSessionError}).
 * 4. `auth.unauthenticated` or `auth.forbidden` from a protected call re-reads the session; a
 *    session that is gone is a sign-out, and a changed role a change of user, so rule 2 applies.
 * 5. A security action (sign in or out, sign up, password reset, passkey added or removed) is run
 *    through {@link SessionGate.settle}, which re-reads the session afterwards. A `NetworkError`
 *    is an unknown outcome, settled by that read rather than reported as a failure. The read runs
 *    even when the browser reports offline.
 * 6. With a {@link SessionChannel}, a change of user seen in one tab makes every other tab of the
 *    app re-read the session at once, rather than when its cached session goes stale.
 */
import {
  hashKey,
  CancelledError,
  type QueryClient,
  QueryClientProvider,
  type QueryFunctionContext,
  type UseQueryOptions,
  useQuery,
} from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useState } from "react";

import { type AppSession, ERROR_CODES } from "@s10n-base/contracts";

import { NetworkError, RpcError } from "./transport";
import { usePending } from "./use-pending";
import {
  type SessionClient,
  SessionClientProvider,
  SESSION_QUERY_KEY,
  sessionQueryOptions,
  useSession,
} from "./session";

/** Thrown in place of a response that belongs to a user who is no longer signed in here. */
export class StaleSessionError extends Error {
  override readonly name = "StaleSessionError";

  constructor() {
    super("The response belongs to a previous session and was discarded.");
  }
}

/** The outcome of a security action, with the session read after it. */
export type SettledAction<T> =
  /** The action answered. `session` is undefined only if the read after it failed. */
  | { readonly kind: "done"; readonly value: T; readonly session: AppSession | null | undefined }
  /**
   * No answer arrived, so it may or may not have happened. `session` is what the server says
   * now, or undefined if it could not be reached either.
   */
  | { readonly kind: "unknown"; readonly session: AppSession | null | undefined };

/** The key prefix of every protected query: `["user", userId, ...parts]`. */
export const PROTECTED_ROOT = "user";

/**
 * The key of a protected query for `session`: `["user", userId, ...parts]`. Use it with
 * `useInfiniteQuery` or `useMutation` keys, and run the request through `gate.guard`.
 */
export function protectedQueryKey(
  session: AppSession | null | undefined,
  parts: readonly unknown[],
): readonly [typeof PROTECTED_ROOT, string | null, ...unknown[]] {
  return [PROTECTED_ROOT, session?.userId ?? null, ...parts];
}

interface ProtectedQueryOptions<T> {
  readonly queryKey: readonly [typeof PROTECTED_ROOT, string | null, ...unknown[]];
  readonly queryFn: (context: QueryFunctionContext) => Promise<T>;
  readonly enabled: boolean;
}

export interface SessionGate {
  readonly queryClient: QueryClient;
  readonly sessionClient: SessionClient;
  readonly sessionQueryOptions: () => ReturnType<typeof sessionQueryOptions>;
  /** The accepted session: `null` signed out, `undefined` not known yet. */
  readonly current: () => AppSession | null | undefined;
  /** Goes up by one every time the accepted user changes. */
  readonly epoch: () => number;
  /** The session from the cache while fresh, or read from the server. For route guards. */
  readonly ensure: () => Promise<AppSession | null>;
  /**
   * Reads the session from the server now, after cancelling any read already in flight (which
   * may have started before the state changed); a read cancelled that way answers with the newer
   * one's result. Undefined when the read fails.
   */
  readonly refresh: () => Promise<AppSession | null | undefined>;
  readonly protectedQueryOptions: <T>(
    session: AppSession | null | undefined,
    parts: readonly unknown[],
    fetcher: (signal: AbortSignal) => Promise<T>,
  ) => ProtectedQueryOptions<T>;
  /**
   * Runs a call on behalf of the current user: its result is discarded if the user changed
   * meanwhile (rules 3 and 4). Use it for mutations; protected queries use it already.
   */
  readonly guard: <T>(run: () => Promise<T>) => Promise<T>;
  /** Runs a security action and re-reads the session (rule 5). */
  readonly settle: <T>(action: () => Promise<T>) => Promise<SettledAction<T>>;
  /**
   * Installs "signed out" without asking the server. Only for a sign-out the server answered
   * with success (its answer cleared the cookie) when the read after it failed: the one case
   * where the client may decide the session state itself.
   */
  readonly confirmSignedOut: () => void;
  /** Stops watching the session. */
  readonly dispose: () => void;
}

/**
 * How the tabs of one app tell each other that the signed-in user changed (rule 6). A post
 * reaches every other subscriber, never the poster.
 */
export interface SessionChannel {
  readonly post: () => void;
  /** Returns a function that stops listening. */
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A {@link SessionChannel} over the browser's `BroadcastChannel`, which reaches the other tabs of
 * the same origin. Undefined where the platform has none (React Native).
 */
export function browserSessionChannel(name: string): SessionChannel | undefined {
  if (typeof globalThis.BroadcastChannel !== "function") return undefined;
  const channel = new BroadcastChannel(name);
  return {
    post: () => {
      channel.postMessage("session-changed");
    },
    subscribe: (listener) => {
      channel.addEventListener("message", listener);
      return () => {
        channel.close();
      };
    },
  };
}

const NOT_SEEN = Symbol("not seen");

/** Refusals that may mean the session changed: its end, or a change of role. */
const SESSION_REFUSALS: ReadonlySet<string> = new Set([
  ERROR_CODES.unauthenticated,
  ERROR_CODES.forbidden,
]);

function identityOf(session: AppSession | null): string | null {
  return session === null ? null : `${session.userId}\u0000${session.role}`;
}

function isPublic(meta: Record<string, unknown> | undefined): boolean {
  return meta?.public === true;
}

export function createSessionGate(options: {
  readonly queryClient: QueryClient;
  readonly sessionClient: SessionClient;
  /** Where to tell other tabs of a change of user, and hear of theirs (rule 6). */
  readonly channel?: SessionChannel | undefined;
}): SessionGate {
  const { queryClient, sessionClient, channel } = options;
  const sessionOptions = () => sessionQueryOptions(sessionClient);
  const sessionHash = hashKey(SESSION_QUERY_KEY);
  let accepted: AppSession | null | typeof NOT_SEEN = NOT_SEEN;
  let epoch = 0;

  // The session query is always kept, even when it was created without its meta (as
  // `setQueryData` does): it is what the next screen renders from.
  const predicate = (query: {
    readonly queryHash: string;
    readonly meta: Record<string, unknown> | undefined;
  }) => query.queryHash !== sessionHash && !isPublic(query.meta);

  const purge = () => {
    epoch += 1;
    // Cancelling aborts each request's signal synchronously; the promise is only bookkeeping.
    void queryClient.cancelQueries({ predicate });
    queryClient.removeQueries({ predicate });
    const mutations = queryClient.getMutationCache();
    for (const mutation of mutations.getAll()) {
      if (!isPublic(mutation.meta)) mutations.remove(mutation);
    }
  };

  const accept = (session: AppSession | null) => {
    const changed = accepted !== NOT_SEEN && identityOf(accepted) !== identityOf(session);
    if (changed) purge();
    accepted = session;
    if (changed) channel?.post();
  };

  const existing = queryClient.getQueryData<AppSession | null>(SESSION_QUERY_KEY);
  if (existing !== undefined) accepted = existing;

  // The cache calls this synchronously when the session query gets new data, before it
  // schedules any observer (React) notification, so the purge always happens first.
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryHash !== sessionHash) return;
    if (event.action.type !== "success") return;
    accept(event.query.state.data as AppSession | null);
  });

  /** The newest read `refresh` started: a read it cancels answers with this one's result. */
  let latest: { readonly result: Promise<AppSession | null | undefined> } | undefined;
  const read = async (own: () => typeof latest): Promise<AppSession | null | undefined> => {
    // A read in flight started before this one, maybe before the state changed: it is
    // cancelled, and answers with this one's result.
    await queryClient.cancelQueries({ queryKey: SESSION_QUERY_KEY });
    try {
      return await queryClient.query({ ...sessionOptions(), staleTime: 0 });
    } catch (error) {
      const newer = latest === own() ? undefined : latest;
      return error instanceof CancelledError ? newer?.result : undefined;
    }
  };
  const refresh = (): Promise<AppSession | null | undefined> => {
    const reading: { result: Promise<AppSession | null | undefined> } = {
      result: read(() => reading),
    };
    latest = reading;
    return reading.result;
  };

  const stopListening = channel?.subscribe(() => void refresh());

  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    const started = epoch;
    let value: T;
    try {
      value = await run();
    } catch (error) {
      if (epoch !== started) throw new StaleSessionError();
      // A refusal for the session (gone) or the role (demoted): the session read decides, and a
      // change of user or role purges (rule 2). A 403 alone never signs anyone out.
      if (error instanceof RpcError && SESSION_REFUSALS.has(error.code)) void refresh();
      throw error;
    }
    if (epoch !== started) throw new StaleSessionError();
    return value;
  };

  return {
    queryClient,
    sessionClient,
    sessionQueryOptions: sessionOptions,
    current: () => (accepted === NOT_SEEN ? undefined : accepted),
    epoch: () => epoch,
    ensure: () => queryClient.query(sessionOptions()),
    refresh,
    protectedQueryOptions: (session, parts, fetcher) => ({
      queryKey: protectedQueryKey(session, parts),
      queryFn: ({ signal }) => guard(() => fetcher(signal)),
      enabled: session !== null && session !== undefined,
    }),
    guard,
    settle: async (action) => {
      let value;
      try {
        value = await action();
      } catch (error) {
        const session = await refresh();
        if (error instanceof NetworkError) return { kind: "unknown", session };
        throw error;
      }
      return { kind: "done", value, session: await refresh() };
    },
    confirmSignedOut: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
    dispose: () => {
      unsubscribe();
      stopListening?.();
    },
  };
}

const SessionGateContext = createContext<SessionGate | null>(null);

/** Provides the gate, its query client and its session client to the tree. */
export function SessionGateProvider(props: {
  readonly gate: SessionGate;
  readonly children?: ReactNode;
}) {
  const { gate } = props;
  return createElement(
    QueryClientProvider,
    { client: gate.queryClient },
    createElement(
      SessionGateContext.Provider,
      { value: gate },
      createElement(SessionClientProvider, { client: gate.sessionClient }, props.children),
    ),
  );
}

export function useSessionGate(): SessionGate {
  const gate = useContext(SessionGateContext);
  if (gate === null) throw new Error("useSessionGate needs a SessionGateProvider above it.");
  return gate;
}

/**
 * A protected query for the signed-in user: `["user", userId, ...parts]`, disabled when signed
 * out. Returns the session it was built for, so a screen can tell "signed out" from "loading".
 */
export function useProtectedQuery<T>(
  parts: readonly unknown[],
  fetcher: (signal: AbortSignal) => Promise<T>,
  extra: Omit<UseQueryOptions<T>, "queryKey" | "queryFn" | "enabled"> = {},
) {
  const gate = useSessionGate();
  const session = useSession();
  const query = useQuery({ ...extra, ...gate.protectedQueryOptions(session, parts, fetcher) });
  return { session, query };
}

/**
 * The session as last read after a security action, and a way to read it again without
 * repeating the action: for a screen whose read after the action failed (`undefined`).
 */
export function useRecheck(initial: AppSession | null | undefined) {
  const gate = useSessionGate();
  const [session, setSession] = useState(initial);
  const [checking, run] = usePending();
  const recheck = () =>
    run(async () => {
      setSession(await gate.refresh());
    });
  return { session, checking, recheck };
}
