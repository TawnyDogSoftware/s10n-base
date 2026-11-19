import { createRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { linkClass, PageShell } from "../components/ui";
import { authedRoute, useSignedInSession } from "./authed";

function HomePage() {
  const { t } = useTranslation("common");
  const session = useSignedInSession();
  return (
    <PageShell title={t("home.title", { name: session.name })} intro={t("home.intro")} width="wide">
      <ul className="flex flex-col gap-2">
        <li>
          <Link to="/profile" className={linkClass}>
            {t("home.profileLink")}
          </Link>
        </li>
        {session.role === "admin" ? (
          <li>
            <Link to="/admin/users" className={linkClass}>
              {t("home.usersLink")}
            </Link>
          </li>
        ) : null}
      </ul>
    </PageShell>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: HomePage,
});
