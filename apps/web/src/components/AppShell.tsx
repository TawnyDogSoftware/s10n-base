import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useSession } from "@s10n-base/client/session";

import { linkClass } from "./ui";

export function AppShell() {
  const { t } = useTranslation("common");
  const session = useSession();
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col font-sans">
      <a
        href="#main"
        className={`${linkClass} bg-background sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:p-2`}
      >
        {t("skipToContent")}
      </a>
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="font-semibold">
            {t("appName")}
          </Link>
          {session ? (
            <nav aria-label={t("nav.label")}>
              <ul className="flex gap-4">
                <li>
                  <Link to="/" className={linkClass} activeOptions={{ exact: true }}>
                    {t("nav.home")}
                  </Link>
                </li>
                <li>
                  <Link to="/profile" className={linkClass}>
                    {t("nav.profile")}
                  </Link>
                </li>
                {session.role === "admin" ? (
                  <li>
                    <Link to="/admin/users" className={linkClass}>
                      {t("nav.users")}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </nav>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-6">
        <Outlet />
      </main>
    </div>
  );
}
