import {
  type AppSettings,
  type CreateNoteInput,
  type CreateProjectInput,
  type UpdateNoteInput,
  type UpdateProjectInput,
  NoteCreateRpc,
  NoteDeleteRpc,
  NoteUpdateRpc,
  ProjectCreateRpc,
  ProjectDeleteRpc,
  ProjectGetRpc,
  ProjectsListRpc,
  ProjectUpdateRpc,
  SettingsGetRpc,
  SettingsUpdateRpc,
} from "@s10n-base/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { callRpc, getBootstrapConfig } from "./client";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  settings: ["settings"] as const,
};

export function useBootstrapQuery() {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: getBootstrapConfig,
  });
}

export function useProjectsQuery() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => callRpc(ProjectsListRpc, {}),
  });
}

export function useProjectDetailQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => callRpc(ProjectGetRpc, { id: projectId }),
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => callRpc(SettingsGetRpc, {}),
  });
}

export function useProjectMutations() {
  const queryClient = useQueryClient();

  const invalidateProjects = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    ]);

  return {
    createProject: useMutation({
      mutationFn: (input: CreateProjectInput) => callRpc(ProjectCreateRpc, input),
      onSuccess: async () => {
        await invalidateProjects();
      },
    }),
    updateProject: useMutation({
      mutationFn: (input: UpdateProjectInput) => callRpc(ProjectUpdateRpc, input),
      onSuccess: async (project) => {
        await Promise.all([
          invalidateProjects(),
          queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) }),
        ]);
      },
    }),
    deleteProject: useMutation({
      mutationFn: (projectId: string) => callRpc(ProjectDeleteRpc, { id: projectId }),
      onSuccess: async (_, projectId) => {
        await Promise.all([
          invalidateProjects(),
          queryClient.removeQueries({ queryKey: queryKeys.project(projectId) }),
        ]);
      },
    }),
  };
}

export function useNoteMutations(projectId: string) {
  const queryClient = useQueryClient();

  const invalidateProject = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
    ]);

  return {
    createNote: useMutation({
      mutationFn: (input: CreateNoteInput) => callRpc(NoteCreateRpc, input),
      onSuccess: async () => {
        await invalidateProject();
      },
    }),
    updateNote: useMutation({
      mutationFn: (input: UpdateNoteInput) => callRpc(NoteUpdateRpc, input),
      onSuccess: async () => {
        await invalidateProject();
      },
    }),
    deleteNote: useMutation({
      mutationFn: (noteId: string) => callRpc(NoteDeleteRpc, { id: noteId }),
      onSuccess: async () => {
        await invalidateProject();
      },
    }),
  };
}

export function useSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: AppSettings) => callRpc(SettingsUpdateRpc, settings),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}
