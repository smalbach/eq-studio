/**
 * The API, as the web app calls it. Same origin in production (the API serves this app) and
 * through Vite's proxy in development, so every path is relative.
 *
 * Errors come back as Problem Details; `ApiError` keeps their `detail` and `errors` so a form
 * can show exactly which field was wrong.
 */
import { accessToken, currentWorkspace, getSession, refreshSession, signedOut } from "@/lib/session";
import type { CaseResult, EnvironmentConfig, ProjectConfig, ProjectFile, ProjectOperation, TestScenario } from "@eq/runner-core";

export class ApiError extends Error {
  constructor(readonly status: number, readonly title: string, message: string, readonly errors: string[] = []) {
    super(message);
  }

  /** The message and every field error, one per line. */
  get full() {
    return [this.message, ...this.errors].join("\n");
  }
}

/**
 * One request to the API. With accounts on, it carries the session's access token and the
 * chosen workspace; an expired token is renewed once from the refresh cookie and the request
 * repeated, so a person is only sent back to the sign-in screen when the session is really over.
 */
export async function api<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  const token = accessToken();
  const workspace = currentWorkspace();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspace) headers["X-Workspace"] = workspace;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Unreachable", "The Endpoint Quality API is not reachable. Is it running? (pnpm run dev, or pnpm start)");
  }
  if (response.status === 401 && !retried && !path.startsWith("/v1/auth/") && getSession().status === "signed-in" && await refreshSession()) return api<T>(method, path, body, true);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/v1/auth/") && getSession().status !== "local") signedOut();
    throw new ApiError(response.status, payload?.title ?? response.statusText, payload?.detail ?? `HTTP ${response.status}`, payload?.errors ?? []);
  }
  return payload as T;
}

export type ProjectSummary = { id: string; slug: string; name: string; rev: number; activeSpecVersionId: string | null; contractVersion: string | null; operationCount: number; updatedAt: string };
export type ProjectDetail = ProjectSummary & { createdAt: string; environments: number; file: ProjectFile };
export type EnvironmentView = EnvironmentConfig & { environmentId: string; rev: number; updatedAt: string };
export type CredentialRole = "primary" | "insufficient" | "alternate";
export type CredentialKind = "bearer" | "api_key" | "basic" | "oauth2_client_credentials" | "oauth2_authorization_code" | "cookie" | "hmac" | "mtls";
/** What a kind needs besides its plain fields; `tls` (a client certificate) fits any kind. Certificates are public: only their private key is a secret. */
export type CredentialOptions = {
  cookieName?: string;
  login?: { method?: "GET" | "POST" | "PUT" | "PATCH"; path: string; body?: string; contentType?: string };
  hmac?: { algorithm?: "sha256" | "sha512"; header?: string; keyId?: string; keyIdHeader?: string; timestampHeader?: string; template?: string; encoding?: "hex" | "base64" };
  tls?: { cert: string; ca?: string };
};
/** The secrets besides `secret`: never returned, only hinted (the last four of a refresh token, `••••` for a PEM). */
export type CredentialSecretHints = { refreshToken?: string; tlsKey?: string; tlsPassphrase?: string };
export type CredentialView = { role: CredentialRole; kind: CredentialKind; headerName: string | null; username: string | null; tokenUrl: string | null; clientId: string | null; scope: string | null; options: CredentialOptions | null; lastFour: string | null; hasSecret: boolean; secretHints: CredentialSecretHints; rev: number; updatedAt: string };
/** A secret left out keeps the stored one; `""` or `null` clears it. */
export type CredentialInput = { kind: CredentialKind; secret?: string; headerName?: string | null; username?: string | null; tokenUrl?: string | null; clientId?: string | null; scope?: string | null; options?: CredentialOptions | null; refreshToken?: string | null; tlsKey?: string | null; tlsPassphrase?: string | null };
export type SpecVersionView = { id: string; hash: string; sourceKind: string; sourceUrl: string | null; openapiVersion: string | null; title: string | null; version: string | null; operationCount: number; createdAt: string; active: boolean };
export type ExampleView = { id: string; name: string; operations: number; environments: { id: string; name: string; baseUrl: string }[]; summary: string };

export type RunStatus = "queued" | "running" | "cancelling" | "passed" | "failed" | "cancelled" | "interrupted" | "error";
export type RunTotals = { total: number; passed: number; failed: number; blocked: number; completed: number };
export type StepRecord = { step?: string; method: string; url: string; status: number | null; ok: boolean; durationMs: number; latency?: { p95: number; budgetMs: number | null }; assertions: { label: string; pass: boolean; detail: string; informative?: boolean }[]; requestBody?: unknown; responseBody?: unknown; error?: string };
export type ApiRunCase = { id: string; runId: string; position: number; operationId: string; scenarioId: string; name: string; method: string; path: string; expectedStatus: number; status: "queued" | "running" | "passed" | "failed" | "blocked" | "skipped"; durationMs: number | null; steps?: StepRecord[] | null };
export type ApiRun = { id: string; projectId: string; environmentId: string; kind: "functional" | "load"; status: RunStatus; scope: string; totals: RunTotals; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; error: string | null; plan?: Record<string, unknown>; report?: Record<string, unknown> | null; cases?: ApiRunCase[] };

export type SyncResult = { pulled: number; pushed: number; conflicts: number; rejected: { type: string; id: string; error: string }[]; skipped: number; durationMs: number };
export type SyncStatus = {
  linked: boolean; url: string | null; workspace: { id: string; name: string } | null; deviceName: string;
  pending: { userCode: string; verificationUri: string; expiresAt: string } | null;
  includeRuns: boolean; projects: string[] | null; secrets: boolean;
  lastSyncAt: string | null; lastError: string | null; lastResult: SyncResult | null;
  openConflicts: number; pendingChanges: number; syncing: boolean; autoSyncSeconds: number;
};
export type SyncConflict = { id: string; type: "spec" | "project" | "environment" | "credential" | "run"; entityId: string; label: string; field: string; mine: unknown; theirs: unknown; device: string; createdAt: string };
export type ApiTokenView = { id: string; name: string; prefix: string; role: string; kind: "api" | "device"; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

const project = (id: string) => `/v1/projects/${encodeURIComponent(id)}`;

export const API = {
  projects: () => api<ProjectSummary[]>("GET", "/v1/projects"),
  project: (id: string) => api<ProjectDetail>("GET", project(id)),
  createProject: (input: { name?: string; spec?: { url: string } | { document: unknown }; environments?: Partial<EnvironmentConfig>[]; generateConfig?: boolean }) => api<{ id: string; slug: string; warnings: string[] }>("POST", "/v1/projects", input),
  importProject: (file: unknown) => api<{ id: string; slug: string }>("POST", "/v1/projects/import", { file }),
  updateProject: (id: string, changes: { name?: string; slug?: string; expectedRev?: number }) => api<{ rev: number }>("PATCH", project(id), changes),
  archiveProject: (id: string) => api<null>("DELETE", project(id)),
  exportProject: (id: string) => api<ProjectFile>("GET", `${project(id)}/export`),

  specVersions: (id: string) => api<SpecVersionView[]>("GET", `${project(id)}/spec-versions`),
  importSpec: (id: string, source: { url: string } | { document: unknown }) => api<{ id: string; created: boolean; operationCount: number; warnings: string[] }>("POST", `${project(id)}/spec-versions`, { source }),
  activateSpec: (id: string, version: string) => api<null>("POST", `${project(id)}/spec-versions/${version}/activate`),
  operations: (id: string) => api<ProjectOperation[]>("GET", `${project(id)}/operations`),

  scenarios: <T,>(id: string, auth: boolean, locale: "es" | "en") => api<T>("GET", `${project(id)}/scenarios?auth=${auth}&locale=${locale}`),
  config: (id: string) => api<{ rev: number; config: ProjectConfig }>("GET", `${project(id)}/config`),
  updateSection: (id: string, section: string, value: unknown, expectedRev?: number) => api<{ rev: number }>("PUT", `${project(id)}/config/${section}`, { value, expectedRev }),
  generateConfig: (id: string, mode: "merge" | "replace") => api<{ rev: number }>("POST", `${project(id)}/config/generate`, { mode }),

  environments: (id: string) => api<EnvironmentView[]>("GET", `${project(id)}/environments`),
  createEnvironment: (id: string, input: Partial<EnvironmentConfig> & { key?: string; name: string; baseUrl: string }) => api<{ id: string; key: string }>("POST", `${project(id)}/environments`, input),
  updateEnvironment: (id: string, environment: string, changes: Record<string, unknown>) => api<{ rev: number }>("PATCH", `${project(id)}/environments/${encodeURIComponent(environment)}`, changes),
  deleteEnvironment: (id: string, environment: string) => api<null>("DELETE", `${project(id)}/environments/${encodeURIComponent(environment)}`),

  credentials: (id: string, environment: string) => api<CredentialView[]>("GET", `${project(id)}/environments/${encodeURIComponent(environment)}/credentials`),
  setCredential: (id: string, environment: string, role: CredentialRole, input: CredentialInput) => api<{ lastFour: string | null; rev: number }>("PUT", `${project(id)}/environments/${encodeURIComponent(environment)}/credentials/${role}`, input),
  deleteCredential: (id: string, environment: string, role: CredentialRole) => api<null>("DELETE", `${project(id)}/environments/${encodeURIComponent(environment)}/credentials/${role}`),

  startRun: (id: string, plan: Record<string, unknown>) => api<{ id: string; total: number }>("POST", `${project(id)}/runs`, plan),
  startLoadRun: (id: string, plan: Record<string, unknown>) => api<{ id: string }>("POST", `${project(id)}/load-runs`, plan),
  runs: (id: string, kind: "functional" | "load", limit = 25) => api<ApiRun[]>("GET", `${project(id)}/runs?kind=${kind}&limit=${limit}&full=true`),
  run: (runId: string) => api<ApiRun>("GET", `/v1/runs/${runId}?steps=true`),
  deleteRun: (runId: string) => api<null>("DELETE", `/v1/runs/${runId}`),
  cancelRun: (runId: string) => api<{ status: string }>("POST", `/v1/runs/${runId}/cancel`),
  probe: (id: string, input: { environment: string; operationId: string; scenarioId: string; parameters?: Record<string, string>; body?: unknown; samples?: number; locale: "es" | "en" }) => api<{ ok: boolean; durationMs: number; steps: CaseResult[] }>("POST", `${project(id)}/probe`, input),

  health: () => api<{ status: string; mode: "local" | "cloud"; auth: "none" | "required"; registration: "open" | "invite" }>("GET", "/health"),
  login: (email: string, password: string) => api<import("@/lib/session").Session>("POST", "/v1/auth/login", { email, password }),
  register: (input: { email: string; password: string; name: string; workspace?: string }) => api<import("@/lib/session").Session>("POST", "/v1/auth/register", input),
  acceptInvitation: (token: string, password: string, name?: string) => api<import("@/lib/session").Session>("POST", "/v1/auth/accept-invitation", { token, password, name }),
  changePassword: (current: string, next: string) => api<null>("POST", "/v1/auth/password", { current, next }),
  createWorkspace: (name: string) => api<{ id: string }>("POST", "/v1/auth/workspaces", { name }),
  me: () => api<{ id: string; email: string; name: string; workspaces: import("@/lib/session").SessionWorkspace[] }>("GET", "/v1/auth/me"),
  members: () => api<{ userId: string; email: string; name: string; role: string; since: string }[]>("GET", "/v1/workspace/members"),
  changeRole: (userId: string, role: string) => api<null>("PATCH", `/v1/workspace/members/${userId}`, { role }),
  removeMember: (userId: string) => api<null>("DELETE", `/v1/workspace/members/${userId}`),
  invitations: () => api<{ id: string; email: string; role: string; expiresAt: string }[]>("GET", "/v1/workspace/invitations"),
  invite: (email: string, role: string) => api<{ id: string; token: string; expiresAt: string }>("POST", "/v1/workspace/invitations", { email, role }),
  cancelInvitation: (id: string) => api<null>("DELETE", `/v1/workspace/invitations/${id}`),
  apiTokens: () => api<ApiTokenView[]>("GET", "/v1/workspace/api-tokens"),
  issueApiToken: (name: string, role: string, expiresInDays?: number) => api<{ id: string; token: string }>("POST", "/v1/workspace/api-tokens", { name, role, expiresInDays }),
  revokeApiToken: (id: string) => api<null>("DELETE", `/v1/workspace/api-tokens/${id}`),

  // Sync. Locally: this installation's link to a cloud workspace. In the cloud: its conflicts and
  // the approval of a device that signs in from the browser.
  syncStatus: () => api<SyncStatus>("GET", "/v1/sync"),
  syncLink: (input: { url: string; token?: string; deviceName?: string }) => api<SyncStatus>("POST", "/v1/sync/link", input),
  syncCheck: () => api<SyncStatus>("POST", "/v1/sync/link/check"),
  syncUnlink: () => api<null>("DELETE", "/v1/sync/link"),
  syncConfigure: (changes: { includeRuns?: boolean; projects?: string[] | null; passphrase?: string | null }) => api<SyncStatus>("PATCH", "/v1/sync", changes),
  syncRun: () => api<SyncResult>("POST", "/v1/sync/run"),
  syncConflicts: () => api<SyncConflict[]>("GET", "/v1/sync/conflicts"),
  resolveConflict: (id: string, choice: "mine" | "theirs") => api<null>("POST", `/v1/sync/conflicts/${encodeURIComponent(id)}/resolve`, { choice }),
  describeDevice: (code: string) => api<{ userCode: string; name: string; expiresAt: string }>("GET", `/v1/auth/device/${encodeURIComponent(code)}`),
  approveDevice: (code: string, workspaceId: string) => api<null>("POST", `/v1/auth/device/${encodeURIComponent(code)}/approve`, { workspaceId }),
  denyDevice: (code: string) => api<null>("POST", `/v1/auth/device/${encodeURIComponent(code)}/deny`),

  examples: () => api<ExampleView[]>("GET", "/v1/examples"),
  importExample: (example: string) => api<{ id: string; slug: string }>("POST", `/v1/examples/${example}/import`),
  fetchSpec: async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new ApiError(response.status, "Bad Gateway", `${url} answered ${response.status}`);
    return response.text();
  },
};

export type StreamEvent = { type: "snapshot"; data: { run: ApiRun; cases: ApiRunCase[] } } | { type: "case"; data: ApiRunCase } | { type: "progress"; data: { status: RunStatus; totals: RunTotals; windows?: unknown[] } } | { type: "finished"; data: ApiRun };

/** Follows a run's server-sent events until it finishes. Returns a function that stops following. */
export function followRun(runId: string, onEvent: (event: StreamEvent) => void, onError?: () => void) {
  // EventSource cannot send headers: the stream route alone also reads the token from the URL.
  const token = accessToken();
  const query = new URLSearchParams({ ...(token ? { access_token: token } : {}), ...(currentWorkspace() ? { workspace: currentWorkspace()! } : {}) }).toString();
  const source = new EventSource(`/v1/runs/${runId}/stream${query ? `?${query}` : ""}`);
  for (const type of ["snapshot", "case", "progress", "finished"] as const) {
    source.addEventListener(type, (message) => {
      onEvent({ type, data: JSON.parse((message as MessageEvent).data) } as StreamEvent);
      if (type === "finished") source.close();
    });
  }
  source.onerror = () => { if (source.readyState === EventSource.CLOSED) onError?.(); };
  return () => source.close();
}

/** A scenario as a test case result the views read, from a probe. */
export type ProbeResult = { ok: boolean; durationMs: number; steps: CaseResult[] };
export type { TestScenario };
