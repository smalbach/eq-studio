/**
 * The project the dashboard is working on.
 *
 * Projects live in the API; this module holds the one that is open, as the API returned it, so
 * the engine's bound helpers (`lib/scenarios.ts`, `lib/execution-plan.ts`, …) — called from event
 * handlers and plain modules with no hook to read from — see the same configuration as the
 * screens. The shell loads it with React Query and hands it over with `setActiveProject`.
 */
import { useSyncExternalStore } from "react";
import { buildEndpoints, type Endpoint, type ProjectFile } from "@eq/runner-core";
import type { ProjectDetail } from "@/lib/api";

export type ActiveProject = { id: string; slug: string; rev: number; file: ProjectFile; endpoints: Endpoint[] };

const ACTIVE_KEY = "endpoint-quality:active-project:v2";

/** A project with nothing in it: what the screens see before one is opened. */
const EMPTY: ActiveProject = { id: "", slug: "", rev: 0, file: { format: "endpoint-quality/project", version: 1, project: { name: "", operations: [] }, environments: [] }, endpoints: [] };

let active: ActiveProject = EMPTY;
const listeners = new Set<() => void>();

export function setActiveProject(detail: ProjectDetail | null) {
  const next = detail ? { id: detail.id, slug: detail.slug, rev: detail.rev, file: detail.file, endpoints: buildEndpoints(detail.file.project) } : EMPTY;
  if (next.id === active.id && next.rev === active.rev && JSON.stringify(next.file) === JSON.stringify(active.file)) return;
  active = next;
  for (const listener of listeners) listener();
}

export function getProject() {
  return active;
}

/** The project to open on start: the last one opened in this browser. */
export function rememberedProjectId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function rememberProjectId(id: string | null) {
  try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* not remembered */ }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useProject(): ActiveProject {
  return useSyncExternalStore(subscribe, getProject, getProject);
}

export function useEndpoints(): Endpoint[] {
  return useProject().endpoints;
}
