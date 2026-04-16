import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { rootRoute } from "./root";
import { useNoteMutations, useProjectDetailQuery, useProjectMutations } from "../rpc/queries";
import { useUiStore } from "../store/uiStore";

function ProjectRouteView() {
  const navigate = useNavigate();
  const { projectId } = projectRoute.useParams();
  const projectQuery = useProjectDetailQuery(projectId);
  const { updateProject, deleteProject } = useProjectMutations();
  const { createNote, updateNote, deleteNote } = useNoteMutations(projectId);
  const denseNotes = useUiStore((state) => state.denseNotes);
  const project = projectQuery.data?.project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  useEffect(() => {
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
  }, [project?.description, project?.name]);

  if (projectQuery.isLoading) {
    return <div className="text-sm text-slate-500">Loading project...</div>;
  }

  if (!project) {
    return <div className="text-sm text-slate-500">Project not found.</div>;
  }

  const detail = projectQuery.data as NonNullable<typeof projectQuery.data>;

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <form
          className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            await updateProject.mutateAsync({
              id: project.id,
              name: name.trim(),
              description: description.trim(),
            });
          }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">
              Project detail
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {project.name}
            </h1>
          </div>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-400"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <textarea
            className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-blue-400"
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-slate-900 px-4 py-3 font-medium text-white"
              type="submit"
            >
              Save project
            </button>
            <button
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-medium text-rose-700"
              onClick={async () => {
                await deleteProject.mutateAsync(project.id);
                await navigate({ to: "/" });
              }}
              type="button"
            >
              Delete project
            </button>
          </div>
        </form>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm font-medium text-slate-900">Quick stats</p>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">{detail.notes.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">Updated</dt>
              <dd className="mt-1 text-sm text-slate-700">
                {new Date(project.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Notes</h2>
            <p className="mt-1 text-sm text-slate-500">
              Each note is stored server-side and reflected in the live activity stream.
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-3 rounded-3xl border border-slate-200 bg-white p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (noteTitle.trim().length === 0) {
              return;
            }

            await createNote.mutateAsync({
              projectId,
              title: noteTitle.trim(),
              body: noteBody.trim(),
            });

            setNoteTitle("");
            setNoteBody("");
          }}
        >
          <input
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400"
            onChange={(event) => setNoteTitle(event.target.value)}
            placeholder="New note title"
            value={noteTitle}
          />
          <textarea
            className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400"
            onChange={(event) => setNoteBody(event.target.value)}
            placeholder="Capture a decision, update, or next step"
            value={noteBody}
          />
          <button
            className="rounded-2xl bg-blue-600 px-4 py-3 font-medium text-white"
            type="submit"
          >
            Add note
          </button>
        </form>

        <div className="mt-5 space-y-4">
          {detail.notes.map((note) => (
            <EditableNoteCard
              dense={denseNotes}
              key={note.id}
              note={note}
              onDelete={async () => {
                await deleteNote.mutateAsync(note.id);
              }}
              onSave={async (title, body) => {
                await updateNote.mutateAsync({ id: note.id, title, body });
              }}
            />
          ))}

          {detail.notes.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              This project does not have any notes yet.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function EditableNoteCard(props: {
  readonly note: {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly updatedAt: string;
  };
  readonly dense: boolean;
  readonly onSave: (title: string, body: string) => Promise<void>;
  readonly onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(props.note.title);
  const [body, setBody] = useState(props.note.body);

  return (
    <form
      className={`rounded-3xl border border-slate-200 bg-white ${props.dense ? "p-4" : "p-5"}`}
      onSubmit={async (event) => {
        event.preventDefault();
        await props.onSave(title.trim(), body.trim());
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400"
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
        <span className="text-xs text-slate-500">
          {new Date(props.note.updatedAt).toLocaleString()}
        </span>
      </div>
      <textarea
        className="mt-3 min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-blue-400"
        onChange={(event) => setBody(event.target.value)}
        value={body}
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <button className="rounded-2xl bg-slate-900 px-4 py-3 font-medium text-white" type="submit">
          Save note
        </button>
        <button
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-medium text-rose-700"
          onClick={props.onDelete}
          type="button"
        >
          Delete note
        </button>
      </div>
    </form>
  );
}

export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: ProjectRouteView,
});
