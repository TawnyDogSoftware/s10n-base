import { Schema } from "effect";

import { DeleteResult } from "./base";
import {
  CreateNoteInput,
  CreateProjectInput,
  DeleteNoteResult,
  Note,
  Project,
  ProjectDetail,
  ProjectList,
  ProjectLookupInput,
  UpdateNoteInput,
  UpdateProjectInput,
} from "./domain";
import { AppSettings } from "./settings";

export interface RpcContract<Payload, Success> {
  readonly method: string;
  readonly payload: Schema.Schema<Payload>;
  readonly success: Schema.Schema<Success>;
}

function defineRpc<Payload, Success>(
  method: string,
  payload: Schema.Schema<Payload>,
  success: Schema.Schema<Success>,
): RpcContract<Payload, Success> {
  return {
    method,
    payload,
    success,
  };
}

const EmptyInput = Schema.Struct({});

export const RPC_METHODS = {
  projectsList: "projects.list",
  projectsGet: "projects.get",
  projectsCreate: "projects.create",
  projectsUpdate: "projects.update",
  projectsDelete: "projects.delete",
  notesCreate: "notes.create",
  notesUpdate: "notes.update",
  notesDelete: "notes.delete",
  settingsGet: "settings.get",
  settingsUpdate: "settings.update",
} as const;

export const EmptyPayload = {} as const;

export const ProjectsListRpc = defineRpc(RPC_METHODS.projectsList, EmptyInput, ProjectList);

export const ProjectGetRpc = defineRpc(RPC_METHODS.projectsGet, ProjectLookupInput, ProjectDetail);

export const ProjectCreateRpc = defineRpc(RPC_METHODS.projectsCreate, CreateProjectInput, Project);

export const ProjectUpdateRpc = defineRpc(RPC_METHODS.projectsUpdate, UpdateProjectInput, Project);

export const ProjectDeleteRpc = defineRpc(
  RPC_METHODS.projectsDelete,
  ProjectLookupInput,
  DeleteResult,
);

export const NoteCreateRpc = defineRpc(RPC_METHODS.notesCreate, CreateNoteInput, Note);

export const NoteUpdateRpc = defineRpc(RPC_METHODS.notesUpdate, UpdateNoteInput, Note);

export const NoteDeleteRpc = defineRpc(
  RPC_METHODS.notesDelete,
  ProjectLookupInput,
  DeleteNoteResult,
);

export const SettingsGetRpc = defineRpc(RPC_METHODS.settingsGet, EmptyInput, AppSettings);

export const SettingsUpdateRpc = defineRpc(RPC_METHODS.settingsUpdate, AppSettings, AppSettings);

export const rpcContracts = [
  ProjectsListRpc,
  ProjectGetRpc,
  ProjectCreateRpc,
  ProjectUpdateRpc,
  ProjectDeleteRpc,
  NoteCreateRpc,
  NoteUpdateRpc,
  NoteDeleteRpc,
  SettingsGetRpc,
  SettingsUpdateRpc,
] as const;
