import Database from "better-sqlite3";

import type { ActivityEntry, Note, Project } from "@s10n-base/contracts";
import { createId } from "@s10n-base/shared/id";
import { nowIso } from "@s10n-base/shared/time";

export interface DatabaseClient {
  readonly database: Database.Database;
  readonly close: () => void;
  readonly listProjects: () => Project[];
  readonly getProject: (id: string) => Project | null;
  readonly getProjectNotes: (projectId: string) => Note[];
  readonly listActivities: (limit: number) => ActivityEntry[];
  readonly createProject: (input: { name: string; description: string }) => Project;
  readonly updateProject: (input: {
    id: string;
    name: string;
    description: string;
  }) => Project | null;
  readonly deleteProject: (id: string) => boolean;
  readonly createNote: (input: { projectId: string; title: string; body: string }) => Note;
  readonly updateNote: (input: { id: string; title: string; body: string }) => Note | null;
  readonly deleteNote: (id: string) => { projectId: string } | null;
  readonly appendActivity: (input: {
    projectId: string | null;
    action: string;
    message: string;
  }) => ActivityEntry;
}

export function createDatabaseClient(databasePath: string): DatabaseClient {
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const listProjectsStatement = database.prepare(`
    SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    ORDER BY updated_at DESC, name COLLATE NOCASE ASC
  `);

  const getProjectStatement = database.prepare(`
    SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    WHERE id = ?
  `);

  const listNotesStatement = database.prepare(`
    SELECT id, project_id AS projectId, title, body, created_at AS createdAt, updated_at AS updatedAt
    FROM notes
    WHERE project_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `);

  const listActivitiesStatement = database.prepare(`
    SELECT id, project_id AS projectId, action, message, created_at AS createdAt
    FROM activities
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const createProjectStatement = database.prepare(`
    INSERT INTO projects (id, name, description, created_at, updated_at)
    VALUES (@id, @name, @description, @createdAt, @updatedAt)
  `);

  const updateProjectStatement = database.prepare(`
    UPDATE projects
    SET name = @name, description = @description, updated_at = @updatedAt
    WHERE id = @id
  `);

  const deleteProjectStatement = database.prepare(`DELETE FROM projects WHERE id = ?`);

  const createNoteStatement = database.prepare(`
    INSERT INTO notes (id, project_id, title, body, created_at, updated_at)
    VALUES (@id, @projectId, @title, @body, @createdAt, @updatedAt)
  `);

  const updateNoteStatement = database.prepare(`
    UPDATE notes
    SET title = @title, body = @body, updated_at = @updatedAt
    WHERE id = @id
  `);

  const getNoteStatement = database.prepare(`
    SELECT id, project_id AS projectId, title, body, created_at AS createdAt, updated_at AS updatedAt
    FROM notes
    WHERE id = ?
  `);

  const deleteNoteStatement = database.prepare(`DELETE FROM notes WHERE id = ?`);

  const createActivityStatement = database.prepare(`
    INSERT INTO activities (id, project_id, action, message, created_at)
    VALUES (@id, @projectId, @action, @message, @createdAt)
  `);

  return {
    database,
    close: () => database.close(),
    listProjects: () => listProjectsStatement.all() as Project[],
    getProject: (id) => (getProjectStatement.get(id) as Project | undefined) ?? null,
    getProjectNotes: (projectId) => listNotesStatement.all(projectId) as Note[],
    listActivities: (limit) => listActivitiesStatement.all(limit) as ActivityEntry[],
    createProject: (input) => {
      const timestamp = nowIso();
      const project: Project = {
        id: createId("project"),
        name: input.name,
        description: input.description,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      createProjectStatement.run(project);
      return project;
    },
    updateProject: (input) => {
      const existing = (getProjectStatement.get(input.id) as Project | undefined) ?? null;
      if (!existing) {
        return null;
      }

      const project: Project = {
        ...existing,
        name: input.name,
        description: input.description,
        updatedAt: nowIso(),
      };

      updateProjectStatement.run(project);
      return project;
    },
    deleteProject: (id) => deleteProjectStatement.run(id).changes > 0,
    createNote: (input) => {
      const timestamp = nowIso();
      const note: Note = {
        id: createId("note"),
        projectId: input.projectId,
        title: input.title,
        body: input.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      createNoteStatement.run(note);
      return note;
    },
    updateNote: (input) => {
      const existing = (getNoteStatement.get(input.id) as Note | undefined) ?? null;
      if (!existing) {
        return null;
      }

      const note: Note = {
        ...existing,
        title: input.title,
        body: input.body,
        updatedAt: nowIso(),
      };

      updateNoteStatement.run(note);
      return note;
    },
    deleteNote: (id) => {
      const existing = (getNoteStatement.get(id) as Note | undefined) ?? null;
      if (!existing) {
        return null;
      }

      deleteNoteStatement.run(id);
      return { projectId: existing.projectId };
    },
    appendActivity: ({ projectId, action, message }) => {
      const activity: ActivityEntry = {
        id: createId("activity"),
        projectId,
        action,
        message,
        createdAt: nowIso(),
      };
      createActivityStatement.run(activity);
      return activity;
    },
  };
}
