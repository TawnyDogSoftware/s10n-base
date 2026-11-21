import { Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button, linkClass, PageShell } from "./ui";

export function NotFound() {
  const { t } = useTranslation("common");
  return (
    <PageShell title={t("notFound.title")} intro={t("notFound.body")}>
      <Link to="/" className={linkClass}>
        {t("notFound.home")}
      </Link>
    </PageShell>
  );
}

export function RouteError() {
  const { t } = useTranslation("common");
  const router = useRouter();
  return (
    <PageShell title={t("routeError.title")} intro={t("routeError.body")}>
      <div>
        <Button onClick={() => void router.invalidate()}>{t("routeError.retry")}</Button>
      </div>
    </PageShell>
  );
}

export function Loading() {
  const { t } = useTranslation("common");
  return <output className="text-muted block py-10 text-center">{t("loading")}</output>;
}
