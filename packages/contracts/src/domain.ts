import { Schema } from "effect";

import { Identifier, Timestamp } from "./base";

export const Project = Schema.Struct({
  id: Identifier,
  name: Schema.String,
  description: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Project = typeof Project.Type;

export const Note = Schema.Struct({
  id: Identifier,
  projectId: Identifier,
  title: Schema.String,
  body: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Note = typeof Note.Type;

export const ProjectDetail = Schema.Struct({
  project: Project,
  notes: Schema.Array(Note),
});
export type ProjectDetail = typeof ProjectDetail.Type;

export const ProjectList = Schema.Struct({
  projects: Schema.Array(Project),
});
export type ProjectList = typeof ProjectList.Type;

export const CreateProjectInput = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});
export type CreateProjectInput = typeof CreateProjectInput.Type;

export const UpdateProjectInput = Schema.Struct({
  id: Identifier,
  name: Schema.String,
  description: Schema.String,
});
export type UpdateProjectInput = typeof UpdateProjectInput.Type;

export const ProjectLookupInput = Schema.Struct({
  id: Identifier,
});
export type ProjectLookupInput = typeof ProjectLookupInput.Type;

export const CreateNoteInput = Schema.Struct({
  projectId: Identifier,
  title: Schema.String,
  body: Schema.String,
});
export type CreateNoteInput = typeof CreateNoteInput.Type;

export const UpdateNoteInput = Schema.Struct({
  id: Identifier,
  title: Schema.String,
  body: Schema.String,
});
export type UpdateNoteInput = typeof UpdateNoteInput.Type;

export const DeleteNoteResult = Schema.Struct({
  id: Identifier,
  projectId: Identifier,
});
export type DeleteNoteResult = typeof DeleteNoteResult.Type;
