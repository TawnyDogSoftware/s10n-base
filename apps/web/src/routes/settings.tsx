import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root";
import { useSettingsMutation, useSettingsQuery } from "../rpc/queries";
import { useUiStore } from "../store/uiStore";

function SettingsRouteView() {
  const settingsQuery = useSettingsQuery();
  const updateSettings = useSettingsMutation();
  const denseNotes = useUiStore((state) => state.denseNotes);
  const showSidebarHints = useUiStore((state) => state.showSidebarHints);
  const setDenseNotes = useUiStore((state) => state.setDenseNotes);
  const setShowSidebarHints = useUiStore((state) => state.setShowSidebarHints);

  if (settingsQuery.isLoading || !settingsQuery.data) {
    return <div className="text-sm text-slate-500">Loading settings...</div>;
  }

  const settings = settingsQuery.data;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Server and local preferences
        </h1>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Server settings</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="rounded-2xl border border-slate-200 bg-white p-4">
            <span className="text-sm font-medium text-slate-900">Default project sort</span>
            <select
              className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              onChange={(event) => {
                void updateSettings.mutateAsync({
                  ...settings,
                  defaultProjectSort: event.target.value as "updatedAt" | "name",
                });
              }}
              value={settings.defaultProjectSort}
            >
              <option value="updatedAt">Most recently updated</option>
              <option value="name">Alphabetical</option>
            </select>
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <span className="text-sm font-medium text-slate-900">Show activity feed</span>
              <p className="mt-1 text-sm text-slate-500">Toggle the live sidebar activity panel.</p>
            </div>
            <input
              checked={settings.showActivityFeed}
              onChange={(event) => {
                void updateSettings.mutateAsync({
                  ...settings,
                  showActivityFeed: event.target.checked,
                });
              }}
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <span className="text-sm font-medium text-slate-900">Compact sidebar</span>
              <p className="mt-1 text-sm text-slate-500">
                Reduce padding in the project navigation.
              </p>
            </div>
            <input
              checked={settings.compactSidebar}
              onChange={(event) => {
                void updateSettings.mutateAsync({
                  ...settings,
                  compactSidebar: event.target.checked,
                });
              }}
              type="checkbox"
            />
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Local browser settings</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <span className="text-sm font-medium text-slate-900">Dense note cards</span>
              <p className="mt-1 text-sm text-slate-500">
                Persisted in local storage with Zustand.
              </p>
            </div>
            <input
              checked={denseNotes}
              onChange={(event) => setDenseNotes(event.target.checked)}
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <span className="text-sm font-medium text-slate-900">Show sidebar hints</span>
              <p className="mt-1 text-sm text-slate-500">A purely client-side preference.</p>
            </div>
            <input
              checked={showSidebarHints}
              onChange={(event) => setShowSidebarHints(event.target.checked)}
              type="checkbox"
            />
          </label>
        </div>
      </section>
    </div>
  );
}

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRouteView,
});
