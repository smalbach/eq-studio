/** A small client of the Endpoint Quality API for the CLI. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

/** Exit codes: what CI scripts branch on. */
export const EXIT = { ok: 0, failed: 1, usage: 2, error: 3 } as const;

export type Client = ReturnType<typeof client>;

/** `token` is an API token (`eqt_…`) for a hosted deployment; `workspace` picks one when the
 * token's user belongs to several (API tokens are bound to one already). */
export function client(base: string, auth: { token?: string; workspace?: string } = {}) {
  const root = base.replace(/\/+$/, "");
  const authHeaders: Record<string, string> = { ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...(auth.workspace ? { "X-Workspace": auth.workspace } : {}) };
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, { method, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...authHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new CliError(`The Endpoint Quality API at ${root} is not reachable. Start it with "eq serve", or pass --file to run without a server.`, EXIT.error);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (response.status === 401) throw new CliError(`${payload?.detail ?? "Unauthorized"}. Pass an API token with --api-token or EQ_API_TOKEN (create one in Settings → API tokens).`, EXIT.usage);
    if (response.status === 403) throw new CliError(`${payload?.detail ?? "Forbidden"}`, EXIT.usage);
    if (!response.ok) throw new CliError([payload?.detail ?? `HTTP ${response.status}`, ...(payload?.errors ?? [])].join("\n  "), response.status === 422 || response.status === 404 ? EXIT.usage : EXIT.error);
    return payload as T;
  }
  return {
    base: root,
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body?: unknown) => call<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => call<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => call<T>("PATCH", path, body),
    delete: <T>(path: string) => call<T>("DELETE", path),
  };
}

export type RunCase = { operationId: string; scenarioId: string; name: string; method: string; path: string; expectedStatus: number; status: string; durationMs: number | null; steps?: { method: string; url: string; status: number | null; ok: boolean; durationMs: number; step?: string; assertions: { label: string; pass: boolean; detail: string; informative?: boolean }[]; error?: string }[] | null };
export type Run = { id: string; kind: "functional" | "load"; status: string; scope: string; totals: { total: number; passed: number; failed: number; blocked: number; completed: number }; durationMs: number | null; error: string | null; createdAt: string; report?: Record<string, unknown> | null; cases?: RunCase[] };

const FINISHED = ["passed", "failed", "cancelled", "interrupted", "error"];

/** Polls a run until it finishes, reporting progress on the way. */
export async function waitForRun(api: Client, runId: string, onProgress: (run: Run) => void, intervalMs = 400): Promise<Run> {
  for (;;) {
    const run = await api.get<Run>(`/v1/runs/${runId}`);
    onProgress(run);
    if (FINISHED.includes(run.status)) return api.get<Run>(`/v1/runs/${runId}?steps=true`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
