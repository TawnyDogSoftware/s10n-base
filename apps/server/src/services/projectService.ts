import { Effect } from "effect";

import type {
  DeleteNoteResult,
  DeleteResult,
  Note,
  Project,
  ProjectDetail,
} from "@s10n-base/contracts";

import type { DatabaseClient } from "../persistence/database";
import type { ActivityHub } from "../ws/hub";

export class ProjectService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly hub: ActivityHub,
  ) {}

  listProjects() {
    return Effect.sync(() => ({ projects: this.database.listProjects() }));
  }

  getProject(id: string) {
    return Effect.sync<ProjectDetail>(() => {
      const project = this.database.getProject(id);
      if (!project) {
        throw new Error(`Project ${id} was not found.`);
      }

      return {
        project,
        notes: this.database.getProjectNotes(id),
      };
    });
  }

  createProject(input: { name: string; description: string }) {
    return Effect.sync<Project>(() => {
      const project = this.database.createProject(input);
      const activity = this.database.appendActivity({
        projectId: project.id,
        action: "project.created",
        message: `Created project ${project.name}`,
      });
      this.hub.broadcast(activity);
      return project;
    });
  }

  updateProject(input: { id: string; name: string; description: string }) {
    return Effect.sync<Project>(() => {
      const project = this.database.updateProject(input);
      if (!project) {
        throw new Error(`Project ${input.id} was not found.`);
      }

      const activity = this.database.appendActivity({
        projectId: project.id,
        action: "project.updated",
        message: `Updated project ${project.name}`,
      });
      this.hub.broadcast(activity);
      return project;
    });
  }

  deleteProject(id: string) {
    return Effect.sync<DeleteResult>(() => {
      const project = this.database.getProject(id);
      if (!project) {
        throw new Error(`Project ${id} was not found.`);
      }

      this.database.deleteProject(id);
      const activity = this.database.appendActivity({
        projectId: id,
        action: "project.deleted",
        message: `Deleted project ${project.name}`,
      });
      this.hub.broadcast(activity);
      return { id };
    });
  }

  createNote(input: { projectId: string; title: string; body: string }) {
    return Effect.sync<Note>(() => {
      const project = this.database.getProject(input.projectId);
      if (!project) {
        throw new Error(`Project ${input.projectId} was not found.`);
      }

      const note = this.database.createNote(input);
      const activity = this.database.appendActivity({
        projectId: project.id,
        action: "note.created",
        message: `Added note ${note.title} to ${project.name}`,
      });
      this.hub.broadcast(activity);
      return note;
    });
  }

  updateNote(input: { id: string; title: string; body: string }) {
    return Effect.sync<Note>(() => {
      const note = this.database.updateNote(input);
      if (!note) {
        throw new Error(`Note ${input.id} was not found.`);
      }

      const project = this.database.getProject(note.projectId);
      const activity = this.database.appendActivity({
        projectId: note.projectId,
        action: "note.updated",
        message: `Updated note ${note.title}${project ? ` in ${project.name}` : ""}`,
      });
      this.hub.broadcast(activity);
      return note;
    });
  }

  deleteNote(id: string) {
    return Effect.sync<DeleteNoteResult>(() => {
      const deleted = this.database.deleteNote(id);
      if (!deleted) {
        throw new Error(`Note ${id} was not found.`);
      }

      const activity = this.database.appendActivity({
        projectId: deleted.projectId,
        action: "note.deleted",
        message: `Deleted a note from project ${deleted.projectId}`,
      });
      this.hub.broadcast(activity);
      return {
        id,
        projectId: deleted.projectId,
      };
    });
  }
}
