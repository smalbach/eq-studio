/**
 * The signed-in session of a hosted deployment, as the browser keeps it.
 *
 * The access token lives in memory only, for its fifteen minutes; the refresh token never
 * reaches script at all — the API keeps it in an httpOnly cookie scoped to `/v1/auth`. A reload
 * gets a fresh access token from that cookie. Locally there are no accounts and none of this is
 * used.
 */
import { useSyncExternalStore } from "react";

export type SessionUser = { id: string; email: string; name: string };
export type SessionWorkspace = { id: string; name: string; role: "viewer" | "editor" | "admin" | "owner" };
export type Session = { accessToken: string; expiresIn: number; user: SessionUser; workspaces: SessionWorkspace[] };
export type SessionState = { status: "local" | "checking" | "signed-out" | "signed-in"; session: Session | null; workspaceId: string | null };

const WORKSPACE_KEY = "endpoint-quality:workspace";
let state: SessionState = { status: "checking", session: null, workspaceId: null };
const listeners = new Set<() => void>();
const set = (next: Partial<SessionState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };

export const getSession = () => state;
export const accessToken = () => state.session?.accessToken ?? null;
export const currentWorkspace = () => state.workspaceId;

function remembered() {
  try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; }
}

export function signedIn(session: Session) {
  const wanted = state.workspaceId ?? remembered();
  const workspaceId = session.workspaces.find((item) => item.id === wanted)?.id ?? session.workspaces[0]?.id ?? null;
  set({ status: "signed-in", session, workspaceId });
}

export const signedOut = () => set({ status: "signed-out", session: null });
export const localMode = () => set({ status: "local", session: null, workspaceId: null });

export function chooseWorkspace(id: string) {
  try { localStorage.setItem(WORKSPACE_KEY, id); } catch { /* not remembered */ }
  set({ workspaceId: id });
}

/** A new access token from the httpOnly refresh cookie; `false` when there is no session left. */
let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch("/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) { signedOut(); return false; }
      signedIn(await response.json() as Session);
      return true;
    } catch { signedOut(); return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function signOut() {
  try { await fetch("/v1/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* the cookie expires anyway */ }
  signedOut();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession);
