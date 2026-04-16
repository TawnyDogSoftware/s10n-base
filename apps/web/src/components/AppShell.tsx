import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { useActivityStream } from "../hooks/useActivityStream";
import { useProjectMutations, useProjectsQuery, useSettingsQuery } from "../rpc/queries";
import { useActivityStore } from "../store/activityStore";
import { useUiStore } from "../store/uiStore";

function prettyTime(input: string) {
  return new Date(input).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AppShell(props: { readonly children?: ReactNode }) {
  useActivityStream();

  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const projectsQuery = useProjectsQuery();
  const settingsQuery = useSettingsQuery();
  const activities = useActivityStore((state) => state.activities);
  const showSidebarHints = useUiStore((state) => state.showSidebarHints);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { createProject } = useProjectMutations();

  const sortedProjects = useMemo(() => {
    const projects = projectsQuery.data?.projects ?? [];
    if (settingsQuery.data?.defaultProjectSort === "name") {
      return [...projects].sort((left, right) => left.name.localeCompare(right.name));
    }
    return projects;
  }, [projectsQuery.data?.projects, settingsQuery.data?.defaultProjectSort]);

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 gap-4 p-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
                S10N Base
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Projects</h1>
              <p className="mt-1 text-sm text-slate-500">
                A reusable app shell with typed server state and a live activity stream.
              </p>
            </div>
            <Link
              className={`rounded-full px-3 py-2 text-sm font-medium ${pathname === "/settings" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              to="/settings"
            >
              Settings
            </Link>
          </div>

          <form
            className="mt-6 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (name.trim().length === 0) {
                return;
              }

              const project = await createProject.mutateAsync({
                name: name.trim(),
                description: description.trim(),
              });

              setName("");
              setDescription("");
              await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
            }}
          >
            <input
              aria-label="Project name"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none ring-0 transition focus:border-blue-400"
              onChange={(event) => setName(event.target.value)}
              placeholder="New project name"
              value={name}
            />
            <textarea
              aria-label="Project description"
              className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short description"
              value={description}
            />
            <button
              className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800"
              type="submit"
            >
              Create project
            </button>
          </form>

          {showSidebarHints ? (
            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              Use the sidebar to create a project, then manage notes inside its detail view.
            </div>
          ) : null}

          <div className="mt-6 space-y-2">
            {sortedProjects.map((project) => {
              const isActive = pathname === `/projects/${project.id}`;
              return (
                <Link
                  className={`block rounded-2xl border px-4 py-3 transition ${isActive ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
                  key={project.id}
                  params={{ projectId: project.id }}
                  to="/projects/$projectId"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-medium">{project.name}</h2>
                    <span className={`text-xs ${isActive ? "text-slate-300" : "text-slate-400"}`}>
                      {prettyTime(project.updatedAt)}
                    </span>
                  </div>
                  <p
                    className={`mt-2 line-clamp-2 text-sm ${isActive ? "text-slate-300" : "text-slate-500"}`}
                  >
                    {project.description || "No description yet."}
                  </p>
                </Link>
              );
            })}

            {sortedProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                No projects yet.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="rounded-3xl border border-white/70 bg-white/85 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          {props.children ?? <Outlet />}
        </main>

        <aside
          className={`rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-y-auto ${settingsQuery.data?.showActivityFeed === false ? "hidden xl:hidden" : "block"}`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live activity</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="size-2 rounded-full bg-emerald-500" />
              WebSocket
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {activities.map((activity) => (
              <article
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                key={activity.id}
              >
                <p className="text-sm font-medium text-slate-900">{activity.message}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{activity.action}</span>
                  <span>{prettyTime(activity.createdAt)}</span>
                </div>
              </article>
            ))}

            {activities.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                Activity will appear here as projects and notes change.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
