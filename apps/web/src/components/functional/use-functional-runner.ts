import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultsFor as engineDefaults, resolvePath as engineResolvePath } from "@eq/runner-core";
import type { Environment } from "@/components/environment/use-environment";
import type { Endpoint } from "@/lib/endpoints";
import { getProject, useProject } from "@/lib/project-store";
import type { TestScenario } from "@/lib/scenarios";
import { API, ApiError, followRun, type ApiRunCase } from "@/lib/api";
import { caseToResult, runToRecord } from "@/lib/run-adapter";
import { pick } from "@/lib/settings.mjs";
import { useLocale } from "@/lib/i18n";
import { tr } from "@/lib/i18n-core.mjs";
import { KEYS } from "@/lib/use-workspace";
import type { OperationStatus, RunRecord, RunResult, ScenarioResult } from "@/lib/run-types";

/** The defaults an endpoint takes: only its path placeholders, each the seed's existing id. */
export function defaultsFor(endpoint: Endpoint) {
  return engineDefaults(endpoint, getProject().file.project);
}

export function resolvePath(endpoint: Endpoint, values: Record<string, string>) {
  return engineResolvePath(endpoint, values, getProject().file.project);
}

export type RunItem = { endpoint: Endpoint; scenario: TestScenario; parameters?: Record<string, string>; useEditorBody?: boolean };
type RunOptions = {
  scope: string;
  /** One endpoint's cases keep the states of the rest of the matrix; a matrix run starts clean. */
  single?: boolean;
  /** The editor's body, sent by the case run with `useEditorBody`. */
  editorBody?: string;
  onCaseStart?: (item: RunItem) => void;
};
export type FunctionalRunner = ReturnType<typeof useFunctionalRunner>;

const caseState = (status: ApiRunCase["status"]): OperationStatus | null => status === "queued" ? "queued" : status === "running" ? "running" : status === "passed" ? "passed" : status === "skipped" ? null : "failed";

/**
 * Functional runs, executed by the API. This hook plans them (the queue the screen built becomes
 * a run plan), follows them over server-sent events and keeps what the screens show: the last
 * response per endpoint and per case, each case's state, and the saved runs.
 *
 * A run belongs to the server: closing the tab does not stop it, and reopening the app finds it
 * in the history. The one exception is a single case run with the editor's values — a probe,
 * answered at once and not saved.
 */
export function useFunctionalRunner(env: Environment) {
  const locale = useLocale();
  const client = useQueryClient();
  const project = useProject();
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [scenarioResults, setScenarioResults] = useState<Record<string, ScenarioResult>>({});
  const [operationStates, setOperationStates] = useState<Record<string, OperationStatus>>({});
  const [active, setActive] = useState<{ endpointId: string; scenarioId: string } | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [busy, setBusy] = useState<null | "single" | "suite">(null);
  const [delayMs, setDelayMs] = useState(0);
  const [samples, setSamples] = useState(1);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const [stopping, setStopping] = useState(false);
  const runningId = useRef<string | null>(null);

  // A different project starts with a clean monitor; its runs stay in its own history.
  const [projectId, setProjectId] = useState(project.id);
  if (projectId !== project.id) {
    setProjectId(project.id);
    setResults({}); setScenarioResults({}); setOperationStates({}); setProgress({ completed: 0, total: 0 }); setLastRun(null);
  }

  const history = useQuery({ queryKey: KEYS.runs(project.id, "functional"), queryFn: () => API.runs(project.id, "functional"), enabled: Boolean(project.id) });
  const environmentOf = useMemo(() => new Map(env.environments.map((item) => [item.environmentId, { name: item.name, baseUrl: item.baseUrl }])), [env.environments]);
  const runs = useMemo(() => (history.data ?? []).filter((run) => !["queued", "running", "cancelling"].includes(run.status)).map((run) => runToRecord(run, environmentOf.get(run.environmentId))), [history.data, environmentOf]);

  const fail = (error: unknown) => alert(error instanceof ApiError ? error.full : error instanceof Error ? error.message : tr(locale, "No se pudo ejecutar", "Could not run"));

  /** One case with the editor's values: the API runs its flow whole and answers at once. */
  async function probe(item: RunItem, editorBody: string | undefined) {
    let body: unknown = undefined;
    if (editorBody?.trim()) { try { body = JSON.parse(editorBody); } catch { throw new Error(tr(locale, "El body no es JSON válido", "The body is not valid JSON")); } }
    const key = `${item.endpoint.id}:${item.scenario.id}`;
    setOperationStates((states) => ({ ...states, [key]: "running" }));
    setActive({ endpointId: item.endpoint.id, scenarioId: item.scenario.id });
    const result = await API.probe(project.id, { environment: env.environmentId, operationId: item.endpoint.id, scenarioId: item.scenario.id, parameters: item.parameters, body, samples, locale }) as ScenarioResult;
    setScenarioResults((current) => ({ ...current, [key]: result }));
    const last = result.steps.at(-1);
    if (last) setResults((current) => ({ ...current, [item.endpoint.id]: last }));
    setOperationStates((states) => ({ ...states, [key]: result.ok ? "passed" : "failed" }));
  }

  /**
   * Starts a run of exactly these cases, in this order, and follows it until it finishes. The
   * queue becomes the plan the API understands: the endpoints in order, and per endpoint the
   * cases picked.
   */
  async function run(items: RunItem[], options: RunOptions): Promise<RunRecord | null> {
    if (!items.length || busy) return null;
    if (!env.environmentId) { fail(tr(locale, "Elige o crea un entorno primero.", "Choose or create an environment first.")); return null; }
    setBusy(options.single ? "single" : "suite");
    setStopping(false);
    setLastRun(null);
    try {
      if (items.length === 1 && items[0].useEditorBody) {
        await probe(items[0], options.editorBody);
        return null;
      }
      const order = [...new Set(items.map((item) => item.endpoint.id))];
      const caseSelection: Record<string, string[]> = {};
      for (const item of items) caseSelection[item.endpoint.id] = [...(caseSelection[item.endpoint.id] ?? []), item.scenario.id];
      const authEnabled = items.some((item) => item.scenario.auth && item.scenario.auth !== "default") || env.authEnabled;
      const started = await API.startRun(project.id, { environment: env.environmentId, scope: options.scope, mode: "custom", customOrder: order, endpointIds: order, caseSelection, authEnabled, samples, delayMs, locale });
      runningId.current = started.id;
      const byKey = new Map(items.map((item) => [`${item.endpoint.id}:${item.scenario.id}`, item]));
      const finished = await new Promise<string>((resolve) => {
        const stop = followRun(started.id, (event) => {
          if (event.type === "snapshot") {
            const queued = Object.fromEntries(event.data.cases.map((item) => [`${item.operationId}:${item.scenarioId}`, "queued" as const]));
            setOperationStates((states) => options.single ? { ...states, ...queued } : queued);
            setProgress({ completed: 0, total: event.data.cases.length });
          }
          if (event.type === "case") {
            const item = event.data;
            const key = `${item.operationId}:${item.scenarioId}`;
            const state = caseState(item.status);
            setOperationStates((states) => { const next = { ...states }; if (state) next[key] = state; else delete next[key]; return next; });
            if (item.status === "running") {
              setActive({ endpointId: item.operationId, scenarioId: item.scenarioId });
              const runItem = byKey.get(key);
              if (runItem) options.onCaseStart?.(runItem);
            } else if (item.steps) {
              const result = caseToResult(item);
              setScenarioResults((current) => ({ ...current, [key]: result }));
              const last = result.steps.at(-1);
              if (last) setResults((current) => ({ ...current, [item.operationId]: last }));
            }
          }
          if (event.type === "progress") setProgress({ completed: event.data.totals.completed, total: event.data.totals.total });
          if (event.type === "finished") { stop(); resolve(event.data.id); }
        }, () => resolve(started.id));
      });
      const saved = await API.run(finished);
      const record = runToRecord(saved, environmentOf.get(saved.environmentId));
      setLastRun(record);
      await client.invalidateQueries({ queryKey: KEYS.runs(project.id, "functional") });
      return record;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      runningId.current = null;
      setActive(null);
      setBusy(null);
      setStopping(false);
    }
  }

  /** Graceful: the case in flight finishes on the server, cleanup included. */
  const requestStop = () => {
    if (!runningId.current) return;
    setStopping(true);
    void API.cancelRun(runningId.current).catch(() => {});
  };

  // A run started elsewhere (another tab, the CLI) shows up in the history when it finishes.
  useEffect(() => { if (!busy) void client.invalidateQueries({ queryKey: KEYS.runs(project.id, "functional") }); }, [busy, client, project.id]);

  const activeEndpoint = active ? project.endpoints.find((item) => item.id === active.endpointId) : undefined;
  const activeScenario = activeEndpoint?.id && active ? { endpoint: activeEndpoint, scenarioId: active.scenarioId } : undefined;
  const removeRun = async (id: string) => { await API.deleteRun(id).catch(fail); await client.invalidateQueries({ queryKey: KEYS.runs(project.id, "functional") }); };

  return {
    results, scenarioResults, operationStates, active: activeScenario, progress, busy, stopping, requestStop,
    delayMs, setDelayMs, delayRemaining: 0, samples, setSamples,
    run, lastRun, dismissLastRun: () => setLastRun(null),
    runs, runsLoading: history.isLoading,
    deleteRun: (id: string) => { void removeRun(id); },
    clearRuns: () => { void Promise.all(runs.map((item) => API.deleteRun(item.id).catch(() => {}))).then(() => client.invalidateQueries({ queryKey: KEYS.runs(project.id, "functional") })); },
    snapshot: { delayMs, samples },
    restore: (saved: Record<string, unknown>) => {
      setDelayMs(pick(saved, "delayMs", 0));
      setSamples(pick(saved, "samples", 1));
    },
  };
}
