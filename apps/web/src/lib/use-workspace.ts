/**
 * The projects of the workspace and the one that is open, read from the API with React Query.
 *
 * Every mutation goes through `useWorkspace().refresh` afterwards, so the screens never show a
 * configuration the API no longer holds.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API, type ProjectSummary } from "@/lib/api";
import { rememberedProjectId, rememberProjectId, setActiveProject } from "@/lib/project-store";

export const KEYS = {
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  environments: (id: string) => ["environments", id] as const,
  credentials: (id: string, environment: string) => ["credentials", id, environment] as const,
  runs: (id: string, kind: "functional" | "load") => ["runs", id, kind] as const,
  specVersions: (id: string) => ["spec-versions", id] as const,
  examples: ["examples"] as const,
};

export type Workspace = ReturnType<typeof useWorkspace>;

export function useWorkspace() {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: KEYS.projects, queryFn: API.projects });
  const [selected, setSelected] = useState<string | null>(() => rememberedProjectId());
  const list: ProjectSummary[] = projects.data ?? [];
  // The remembered project if it still exists, the first one otherwise.
  const activeId = list.find((item) => item.id === selected)?.id ?? list[0]?.id ?? null;
  const project = useQuery({ queryKey: KEYS.project(activeId ?? ""), queryFn: () => API.project(activeId!), enabled: Boolean(activeId) });
  useEffect(() => { setActiveProject(activeId ? project.data ?? null : null); }, [activeId, project.data]);

  const open = useCallback((id: string) => { setSelected(id); rememberProjectId(id); }, []);
  /** Re-reads the list and the open project, its environments and versions. */
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: KEYS.projects });
    await client.invalidateQueries({ predicate: (query) => ["project", "environments", "spec-versions", "credentials"].includes(String(query.queryKey[0])) });
  }, [client]);

  return {
    projects: list,
    loading: projects.isLoading || (Boolean(activeId) && project.isLoading),
    error: projects.error ?? project.error,
    activeId,
    detail: project.data ?? null,
    open,
    refresh,
  };
}
