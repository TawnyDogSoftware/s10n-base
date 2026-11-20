/**
 * The admin user list, on the web and on mobile: newest first, a page at a time, under the
 * signed-in admin's protected key.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { adminListUsers } from "@s10n-base/contracts";

import { protectedQueryKey, useSessionGate } from "./query-state";
import type { RpcClient } from "./rpc";
import { useSession } from "./session";

/**
 * The list's query, and `loadMore`, which asks for the next page. When the page it asked for
 * is the last, `onLastPage` gets the index of its first row: the "Load more" button is gone, so
 * the screen moves focus there or says the list is complete.
 */
export function useUserList(options: {
  readonly rpc: RpcClient;
  readonly pageSize: number;
  readonly onLastPage: (firstNewRow: number) => void;
}) {
  const { rpc, pageSize, onLastPage } = options;
  const gate = useSessionGate();
  const session = useSession();
  const query = useInfiniteQuery({
    // A protected key and a guarded call, as useProtectedQuery would build them.
    queryKey: protectedQueryKey(session, ["admin", "users"]),
    queryFn: ({ pageParam, signal }) =>
      gate.guard(() =>
        rpc.call(
          adminListUsers,
          { limit: pageSize, ...(pageParam === null ? {} : { cursor: pageParam }) },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: session?.role === "admin",
  });
  /** Where "Load more" was pressed: the first row it asked for, and the pages loaded then. */
  const asked = useRef<{ readonly row: number; readonly pages: number } | null>(null);
  const pages = query.data?.pages ?? [];
  const loaded = pages.length;
  const { hasNextPage } = query;
  // The latest callback, without making the effect below run for every new one.
  const lastPage = useRef(onLastPage);
  useEffect(() => {
    lastPage.current = onLastPage;
  });
  useEffect(() => {
    const at = asked.current;
    if (at === null || loaded <= at.pages || hasNextPage) return;
    asked.current = null;
    lastPage.current(at.row);
  }, [loaded, hasNextPage]);
  const loadMore = () => {
    asked.current = {
      row: pages.reduce((count, page) => count + page.users.length, 0),
      pages: loaded,
    };
    void query.fetchNextPage();
  };
  return { query, loadMore };
}
