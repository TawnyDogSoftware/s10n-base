import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useBootstrapQuery } from "../rpc/queries";

export function AppShell(props: { readonly children?: ReactNode }) {
  const bootstrapQuery = useBootstrapQuery();

  return (
    <div className="flex min-h-screen flex-col text-slate-900">
      <header className="mx-auto w-full max-w-5xl px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">S10N Base</p>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">{props.children ?? <Outlet />}</main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-5 text-xs text-slate-500">
        {bootstrapQuery.data ? `Version ${bootstrapQuery.data.appVersion}` : null}
      </footer>
    </div>
  );
}
