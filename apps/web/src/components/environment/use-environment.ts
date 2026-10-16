import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { localized, tr } from "@eq/runner-core";
import { API, ApiError, type CredentialKind, type CredentialRole, type EnvironmentView } from "@/lib/api";
import { parsePostmanEnvironment } from "@/lib/postman-environment.mjs";
import { inspectToken } from "@/lib/environments.mjs";
import { useProject } from "@/lib/project-store";
import { KEYS } from "@/lib/use-workspace";
import type { TestScenario } from "@/lib/scenarios";
import { isLoopback } from "@/lib/format";
import { useLocale } from "@/lib/i18n";

export type TokenStatus = { dot: string; label: string };
export type Environment = ReturnType<typeof useEnvironment>;
export type CredentialDraft = { kind: CredentialKind; secret?: string; headerName?: string | null; username?: string | null; tokenUrl?: string | null; clientId?: string | null; scope?: string | null };

/** The case the load tests and the id discovery authenticate as. */
export const DEFAULT_CREDENTIAL_CASE: TestScenario = { id: "default", name: "default", description: "", expectedStatus: 200, flow: "request" };

const ENVIRONMENT_KEY = (projectId: string) => `endpoint-quality:environment:${projectId}`;

/** What an environment allows, with the defaults its URL implies — the same rules as the API. */
export function settingsOf(environment: Pick<EnvironmentView, "baseUrl" | "seeded" | "writesAllowed" | "enforceLatency" | "authEnabled"> | undefined) {
  const local = environment ? isLoopback(environment.baseUrl) : true;
  const seeded = environment?.seeded ?? local;
  return { seeded, writesAllowed: environment?.writesAllowed ?? seeded, enforceLatency: environment?.enforceLatency ?? local, authEnabled: environment?.authEnabled ?? false };
}

/**
 * Where the dashboard points: one of the project's environments, as the API keeps them, and the
 * credentials each kind of case presents there. Credentials are stored encrypted by the API and
 * never come back — the panel only learns whether one is set and its last four characters.
 */
export function useEnvironment() {
  const locale = useLocale();
  const client = useQueryClient();
  const project = useProject();
  const environmentsQuery = useQuery({ queryKey: KEYS.environments(project.id), queryFn: () => API.environments(project.id), enabled: Boolean(project.id) });
  const environments = environmentsQuery.data ?? [];
  // The environment chosen here, for this project; otherwise the one last used with it.
  const [choice, setChoice] = useState<{ project: string; id: string | null } | null>(null);
  const remembered = useMemo(() => { try { return localStorage.getItem(ENVIRONMENT_KEY(project.id)); } catch { return null; } }, [project.id]);
  const selected = choice?.project === project.id ? choice.id : remembered;
  const setSelected = (id: string | null) => setChoice({ project: project.id, id });
  const [environmentError, setEnvironmentError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);

  const active = environments.find((item) => item.id === selected) ?? environments[0];
  const credentialsQuery = useQuery({ queryKey: KEYS.credentials(project.id, active?.environmentId ?? ""), queryFn: () => API.credentials(project.id, active!.environmentId), enabled: Boolean(project.id && active) });
  const credentials = credentialsQuery.data ?? [];
  const settings = settingsOf(active);
  const primary = credentials.find((item) => item.role === "primary");
  // A JWT typed in this tab is read for its expiry; once saved, the API keeps it and only the
  // last four characters come back.
  const [typedToken, setTypedToken] = useState("");
  const tokenInfo = inspectToken(typedToken, now);

  const fail = (error: unknown) => setEnvironmentError(error instanceof ApiError ? error.full : error instanceof Error ? error.message : String(error));
  const reloadEnvironments = () => client.invalidateQueries({ queryKey: KEYS.environments(project.id) });
  const reloadCredentials = () => client.invalidateQueries({ queryKey: ["credentials", project.id] });

  const selectEnvironment = (environment: EnvironmentView) => {
    setSelected(environment.id);
    setEnvironmentError("");
    try { localStorage.setItem(ENVIRONMENT_KEY(project.id), environment.id); } catch { /* not remembered */ }
  };

  /** Saves changes to the active environment; `null` clears an optional field. */
  async function saveEnvironment(changes: Record<string, unknown>) {
    if (!active) return;
    setEnvironmentError("");
    try { await API.updateEnvironment(project.id, active.environmentId, { ...changes, expectedRev: active.rev }); } catch (error) { fail(error); }
    await reloadEnvironments();
  }

  async function createEnvironment(input: { name: string; baseUrl: string; specUrl?: string; seeded?: boolean; writesAllowed?: boolean }) {
    setEnvironmentError("");
    try {
      const created = await API.createEnvironment(project.id, input);
      await reloadEnvironments();
      setSelected(created.key);
      try { localStorage.setItem(ENVIRONMENT_KEY(project.id), created.key); } catch { /* not remembered */ }
      return true;
    } catch (error) { fail(error); return false; }
  }

  async function deleteEnvironment() {
    if (!active) return;
    try { await API.deleteEnvironment(project.id, active.environmentId); setSelected(null); } catch (error) { fail(error); }
    await reloadEnvironments();
  }

  async function saveCredential(role: CredentialRole, draft: CredentialDraft) {
    if (!active) return false;
    setEnvironmentError("");
    try {
      await API.setCredential(project.id, active.environmentId, role, draft);
      if (role === "primary") setTypedToken(draft.secret ?? "");
      await reloadCredentials();
      return true;
    } catch (error) { fail(error); return false; }
  }

  async function deleteCredential(role: CredentialRole) {
    if (!active) return;
    try { await API.deleteCredential(project.id, active.environmentId, role); } catch (error) { fail(error); }
    await reloadCredentials();
  }

  /** A Postman environment export becomes an environment of the project, with its token and key. */
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files)) {
        const parsed = parsePostmanEnvironment(await file.text(), file.name.replace(/\.postman_environment\.json$|\.json$/, ""), locale) as { name: string; fields: { baseUrl?: string; token?: string; apiKey?: string; readToken?: string } };
        if (!parsed.fields.baseUrl) throw new Error(tr(locale, `${file.name} no tiene una URL base`, `${file.name} has no base URL`));
        const created = await API.createEnvironment(project.id, { name: parsed.name, baseUrl: parsed.fields.baseUrl });
        if (parsed.fields.token) await API.setCredential(project.id, created.key, "primary", { kind: "bearer", secret: parsed.fields.token });
        if (parsed.fields.readToken) await API.setCredential(project.id, created.key, "insufficient", { kind: "bearer", secret: parsed.fields.readToken });
        if (parsed.fields.apiKey) await API.setCredential(project.id, created.key, "alternate", { kind: "api_key", secret: parsed.fields.apiKey });
        setSelected(created.key);
      }
      await reloadEnvironments();
    } catch (error) { fail(error); }
  }

  const tokenStatus: TokenStatus = !primary
    ? { dot: "bg-slate-300", label: tr(locale, "Sin credencial principal", "No primary credential") }
    : tokenInfo.state === "expired"
      ? { dot: "bg-rose-500", label: tr(locale, "Token expirado", "Token expired") }
      : { dot: "bg-emerald-500", label: tr(locale, `Credencial ${primary.kind} cargada`, `${primary.kind} credential loaded`) };

  return {
    projectId: project.id,
    environments, active, environmentId: active?.environmentId ?? "",
    label: active?.name ?? tr(locale, "Sin entorno", "No environment"),
    description: active?.description ? localized(locale, active.description) : "",
    baseUrl: active?.baseUrl ?? "", specUrl: active?.specUrl ?? "",
    ...settings,
    loading: environmentsQuery.isLoading,
    environmentError, setEnvironmentError, now,
    credentials, saveCredential, deleteCredential,
    apiKeyHeader: project.file.project.auth?.apiKeyHeader ?? "X-API-Key",
    tokenInfo, tokenStatus,
    tokenMinutesLeft: tokenInfo.state === "valid" ? tokenInfo.minutesLeft ?? null : null,
    selectEnvironment, saveEnvironment, createEnvironment, deleteEnvironment, importFiles,
    /** Kept for the panels that ask whether the target is the seed. */
    local: settings.seeded,
    /** Load tests on anything but a disposable environment hit something other people use. */
    shared: !settings.seeded,
  };
}
