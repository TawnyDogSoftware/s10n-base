import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import { errorMessageKey } from "@s10n-base/client/messages";
import { protectedQueryKey } from "@s10n-base/client/query-state";
import { useSession } from "@s10n-base/client/session";
import { adminListUsers } from "@s10n-base/contracts";

import { Body, Button, Loading, Notice, Screen } from "../components/ui";
import { useServices } from "../services";

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
  if (users.length === 0) return <Body>{t("empty")}</Body>;
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <>
      {users.map((user) => (
        <View key={user.id} role="listitem" className="border-border gap-1 rounded-md border p-3">
          <Text className="text-foreground font-semibold">{user.name}</Text>
          <Body>{user.email}</Body>
          {[
            { label: t("columns.role"), value: t(`roles.${user.role}`) },
            { label: t("columns.verified"), value: user.emailVerified ? t("yes") : t("no") },
            { label: t("columns.status"), value: user.banned ? t("banned") : t("active") },
            { label: t("columns.created"), value: date.format(new Date(user.createdAt)) },
          ].map(({ label, value }) => (
            <Body key={label} muted>
              {t("detail", { label, value })}
            </Body>
          ))}
        </View>
      ))}
      {query.isRefetchError ? (
        <Notice tone="danger" announce={t("refreshFailed")}>
          <Body>{t("refreshFailed")}</Body>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            {tCommon("routeError.retry")}
          </Button>
        </Notice>
      ) : null}
      {query.isFetchNextPageError ? (
        <Notice tone="danger">{tError(errorMessageKey(query.error))}</Notice>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          pending={query.isFetchingNextPage}
          pendingLabel={t("loadingMore")}
          onPress={() => void query.fetchNextPage()}
        >
          {t("loadMore")}
        </Button>
      ) : null}
    </>
  );
}

/** Admin only, newest first; a signed-in user who is not an admin sees "not allowed". */
export function UsersScreen() {
  const { t } = useTranslation("admin");
  const session = useSession();
  if (session?.role !== "admin") {
    return <Screen title={t("notAllowedTitle")} intro={t("notAllowedBody")} />;
  }
  return (
    <Screen title={t("title")} intro={t("intro")}>
      <UserList />
    </Screen>
  );
}
