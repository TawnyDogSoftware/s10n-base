import { useInfiniteQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { errorMessageKey } from "@s10n-base/client/messages";
import { protectedQueryKey } from "@s10n-base/client/query-state";
import { useSession } from "@s10n-base/client/session";
import { adminListUsers } from "@s10n-base/contracts";

import { Loading } from "../components/RouteStates";
import { Button, Notice, PageShell } from "../components/ui";
import { useServices } from "../services";
import { authedRoute } from "./authed";

export const ADMIN_USERS_PAGE_SIZE = 25;

function UserList() {
  const { t, i18n } = useTranslation("admin");
  const { t: tError } = useTranslation("errors");
  const { t: tCommon } = useTranslation("common");
  const { rpc, gate } = useServices();
  const session = useSession();
  const query = useInfiniteQuery({
    // A protected key and a guarded call, as useProtectedQuery would build them.
    queryKey: protectedQueryKey(session, ["admin", "users"]),
    queryFn: ({ pageParam, signal }) =>
      gate.guard(() =>
        rpc.call(
          adminListUsers,
          { limit: ADMIN_USERS_PAGE_SIZE, ...(pageParam === null ? {} : { cursor: pageParam }) },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: session?.role === "admin",
  });

  if (query.isPending) return <Loading />;
  if (query.isError && query.data === undefined) {
    return <Notice tone="danger">{tError(errorMessageKey(query.error))}</Notice>;
  }
  const users = query.data.pages.flatMap((page) => page.users);
  if (users.length === 0) return <p>{t("empty")}</p>;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="py-2 pr-4">
                {t("columns.name")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("columns.email")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("columns.role")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("columns.verified")}
              </th>
              <th scope="col" className="py-2 pr-4">
                {t("columns.status")}
              </th>
              <th scope="col" className="py-2">
                {t("columns.created")}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-border border-b">
                <td className="py-2 pr-4">{user.name}</td>
                <td className="py-2 pr-4">{user.email}</td>
                <td className="py-2 pr-4">{t(`roles.${user.role}`)}</td>
                <td className="py-2 pr-4">{user.emailVerified ? t("yes") : t("no")}</td>
                <td className="py-2 pr-4">{user.banned ? t("banned") : t("active")}</td>
                <td className="py-2">{date.format(new Date(user.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.isRefetchError ? (
        <Notice tone="danger">
          <p>{t("refreshFailed")}</p>
          <div>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {tCommon("routeError.retry")}
            </Button>
          </div>
        </Notice>
      ) : null}
      {query.isFetchNextPageError ? (
        <Notice tone="danger">{tError(errorMessageKey(query.error))}</Notice>
      ) : null}
      {query.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            pending={query.isFetchingNextPage}
            pendingLabel={t("loadingMore")}
            onClick={() => void query.fetchNextPage()}
          >
            {t("loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AdminUsersPage() {
  const { t } = useTranslation("admin");
  const session = useSession();
  if (session?.role !== "admin") {
    return <PageShell title={t("notAllowedTitle")} intro={t("notAllowedBody")} />;
  }
  return (
    <PageShell title={t("title")} intro={t("intro")} width="wide">
      <UserList />
    </PageShell>
  );
}

export const adminUsersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/admin/users",
  component: AdminUsersPage,
});
