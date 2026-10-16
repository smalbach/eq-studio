import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API, ApiError, followRun } from "@/lib/api";
import { loadRunToRecord } from "@/lib/run-adapter";
import { KEYS } from "@/lib/use-workspace";
import { buildStages, dataKeysOf, defaultLoadData, expectedRequests, LOAD_LIMITS, loadCatalog, loadMixes, localized, placeholdersOf, targetBudget, TEST_TYPES, totalDuration } from "@/lib/load.mjs";
import { useProject } from "@/lib/project-store";
import { tr } from "@/lib/i18n-core.mjs";
import { useLocale, type Locale } from "@/lib/i18n";
import { pick } from "@/lib/settings.mjs";
import { usePersistedSettings } from "@/lib/use-persisted-settings";
import { download, fileStamp } from "@/lib/format";
import { type LatencyChoice, type LoadReport, type LoadRun, type LoadTarget, type LoadWindow, type PreflightPolicy, type PreflightResult, type TestType } from "@/lib/load-types";

const DEFAULTS: Record<TestType, { baseRps: number; peakRps: number; durationS: number }> = {
  load: { baseRps: 20, peakRps: 20, durationS: 60 },
  stress: { baseRps: 10, peakRps: 100, durationS: 100 },
  spike: { baseRps: 10, peakRps: 100, durationS: 60 },
  soak: { baseRps: 20, peakRps: 20, durationS: 600 },
};
/** Across a VPN or a gateway a single request can take hundreds of milliseconds: a p95 under
 * load near 1.5 s is healthy there. */
export const REMOTE_P95_MS = 1500;
/** The load profile holds no credential: the headers come from the environment at run time. */
const NO_CREDENTIALS = { credentials: false, secrets: false };

export const parseList = (value: string | undefined) => (value ?? "").split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
export const testTypeLabel = (type: string, locale: Locale = "es") => { const item = TEST_TYPES.find((entry) => entry.id === type); return item ? localized(item, locale).label : type; };

export function exportLoadReport(run: Pick<LoadRun, "at" | "type" | "environment" | "baseUrl">, report: LoadReport) {
  download(`eq-load-${run.type}-${fileStamp(run.at)}.json`, JSON.stringify({ generatedAt: new Date(run.at).toISOString(), environment: run.environment, baseUrl: run.baseUrl, type: run.type, report }, null, 2), "application/json");
}

type Target = { environmentId: string; baseUrl: string; environmentName: string; environments: { environmentId: string; name: string; baseUrl: string }[]; remote: boolean };
export type LoadRunner = ReturnType<typeof useLoadRunner>;

/**
 * Load, stress, spike and soak tests against the environment the rest of the dashboard points
 * at, with its credentials. The engine is `lib/load.mjs`, run server-side by `/api/load` and
 * streamed back one window per second; this hook holds the configuration, the test in flight
 * and every finished test. It lives in the shell, so a test keeps running across screens.
 */
export function useLoadRunner({ environmentId, baseUrl, environmentName, environments, remote }: Target) {
  const client = useQueryClient();
  const runningId = useRef<string | null>(null);
  const locale = useLocale();
  const t = (es: string, en: string) => tr(locale, es, en);
  // The targets, mixes and data lists come from the project; switching project starts over.
  const project = useProject();
  const loadConfig = useMemo(() => project.file.load ?? {}, [project]);
  const catalog = useMemo(() => loadCatalog(project.file.project.operations, loadConfig), [project, loadConfig]);
  const mixes = useMemo(() => loadMixes(catalog, loadConfig), [catalog, loadConfig]);
  const dataKeys = useMemo(() => dataKeysOf(catalog), [catalog]);
  const seedData = () => Object.fromEntries(Object.entries(defaultLoadData(dataKeys, loadConfig, catalog)).map(([key, values]) => [key, values.join(", ")]));
  const firstMix = mixes[0];
  const [type, setType] = useState<TestType>("load");
  const [mixId, setMixId] = useState(firstMix?.id ?? "custom");
  const [targets, setTargets] = useState<LoadTarget[]>(() => (firstMix?.targets ?? []).map((target) => ({ ...target })));
  const [data, setData] = useState<Record<string, string>>(seedData);
  const [projectId, setProjectId] = useState(project.id);
  if (projectId !== project.id) {
    setProjectId(project.id);
    setMixId(firstMix?.id ?? "custom");
    setTargets((firstMix?.targets ?? []).map((target) => ({ ...target })));
    setData(seedData());
  }
  const [dataSource, setDataSource] = useState("seed");
  const [baseRps, setBaseRps] = useState(DEFAULTS.load.baseRps);
  const [peakRps, setPeakRps] = useState(DEFAULTS.load.peakRps);
  const [durationS, setDurationS] = useState(DEFAULTS.load.durationS);
  const [maxInFlight, setMaxInFlight] = useState(256);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [latencyChoice, setLatencyChoice] = useState<LatencyChoice>("auto");
  const [p95Ms, setP95Ms] = useState(REMOTE_P95_MS);
  const [policy, setPolicy] = useState<PreflightPolicy>("skip");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("");
  const [windows, setWindows] = useState<LoadWindow[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult[]>([]);
  const [lastRun, setLastRun] = useState<LoadRun | null>(null);
  const [error, setError] = useState("");
  const loadingData = false;
  usePersistedSettings("load", { project: project.id, type, mixId, targets, data, dataSource, baseRps, peakRps, durationS, maxInFlight, timeoutMs, latencyChoice, p95Ms, policy }, (saved) => {
    const savedType = pick(saved, "type", "load");
    if (TEST_TYPES.some((item) => item.id === savedType)) setType(savedType as TestType);
    // Targets and data belong to the project they were set for.
    if (pick(saved, "project", "") === project.id) {
      setMixId(pick(saved, "mixId", firstMix?.id ?? "custom"));
      const savedTargets = pick(saved, "targets", [] as LoadTarget[]).filter((target) => target && typeof target.path === "string");
      if (savedTargets.length) setTargets(savedTargets.map((target) => ({ label: String(target.label ?? `GET ${target.path}`), method: "GET", path: target.path, weight: Number(target.weight) || 0 })));
      setData((current) => ({ ...current, ...pick(saved, "data", {} as Record<string, string>) }));
      setDataSource(pick(saved, "dataSource", "seed"));
    }
    setBaseRps(pick(saved, "baseRps", DEFAULTS.load.baseRps));
    setPeakRps(pick(saved, "peakRps", DEFAULTS.load.peakRps));
    setDurationS(pick(saved, "durationS", DEFAULTS.load.durationS));
    setMaxInFlight(pick(saved, "maxInFlight", 256));
    setTimeoutMs(pick(saved, "timeoutMs", 5000));
    const savedLatency = pick(saved, "latencyChoice", "auto");
    if (["auto", "project", "custom", "off"].includes(savedLatency)) setLatencyChoice(savedLatency as LatencyChoice);
    setP95Ms(pick(saved, "p95Ms", REMOTE_P95_MS));
    const savedPolicy = pick(saved, "policy", "skip");
    if (["skip", "stop", "ignore"].includes(savedPolicy)) setPolicy(savedPolicy as PreflightPolicy);
  }, NO_CREDENTIALS);
  const environmentOf = useCallback((id: string) => { const found = environments.find((item) => item.environmentId === id); return found ? { name: found.name, baseUrl: found.baseUrl } : undefined; }, [environments]);
  const mixLabel = useCallback((id: string | undefined) => { const mix = mixes.find((item) => item.id === id); return mix ? localized(mix, locale).label : t("Personalizado", "Custom"); }, [mixes, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- `t` is the locale

  const usesPeak = type === "stress" || type === "spike";
  const stages = useMemo(() => buildStages(type, { baseRps, peakRps: usesPeak ? peakRps : baseRps, durationS }, locale), [type, baseRps, peakRps, durationS, usesPeak, locale]);
  const duration = totalDuration(stages);
  const requests = expectedRequests(stages);
  // `auto` is the project's budgets next to the API and a p95 limit of its own across a network.
  const budgetRules = project.file.project.budgets;
  const latency = useMemo(() => {
    const mode = latencyChoice === "auto" ? (remote ? "custom" : "project") : latencyChoice;
    return mode === "custom" ? { mode, p95Ms } : mode === "project" ? { mode, rules: budgetRules ?? [] } : { mode };
  }, [latencyChoice, remote, p95Ms, budgetRules]);
  const budget = useMemo(() => {
    const values = targets.map((target) => targetBudget(target, latency)?.ms).filter((value): value is number => value != null);
    return values.length ? Math.max(...values) : null;
  }, [targets, latency]);
  const missingData = useMemo(() => [...new Set(targets.filter((target) => target.weight > 0).flatMap(placeholdersOf).filter((name) => !parseList(data[name]).length))], [targets, data]);

  const chooseType = (next: TestType) => { setType(next); setBaseRps(DEFAULTS[next].baseRps); setPeakRps(DEFAULTS[next].peakRps); setDurationS(DEFAULTS[next].durationS); };
  const chooseMix = (id: string) => { setMixId(id); const mix = mixes.find((item) => item.id === id); if (mix) setTargets(mix.targets.map((target) => ({ ...target }))); };
  const editTargets = (change: (current: LoadTarget[]) => LoadTarget[]) => { setMixId("custom"); setTargets(change); };
  const updateTarget = (index: number, patch: Partial<LoadTarget>) => editTargets((current) => current.map((target, position) => position === index ? { ...target, ...patch } : target));
  const toggleCatalog = (path: string, label: string) => editTargets((current) => current.some((target) => target.path === path) ? current.filter((target) => target.path !== path) : current.length >= LOAD_LIMITS.maxTargets ? current : [...current, { label, method: "GET", path, weight: 1 }]);

  /**
   * The environment's own ids are read by the API when the test starts, unless the lists were
   * edited here: then exactly what is typed is sent.
   */
  const loadEnvironmentData = async () => { setDataSource("environment"); return data; };

  /** Follows a load run's stream: the live windows, then the saved report. */
  async function follow(runId: string) {
    return new Promise<void>((resolve) => {
      let seen = 0;
      const stop = followRun(runId, (event) => {
        if (event.type === "snapshot" || event.type === "progress") setPhase(t("Enviando carga…", "Sending load…"));
        if (event.type === "progress" && event.data.windows) {
          // The stream carries the last few windows; only the new ones are appended.
          const windows = event.data.windows as LoadWindow[];
          const fresh = windows.filter((window) => window.t > seen);
          if (fresh.length) { seen = fresh.at(-1)!.t; setWindows((current) => [...current, ...fresh]); }
        }
        if (event.type === "finished") { stop(); resolve(); }
      }, () => resolve());
    });
  }

  async function start() {
    setError(""); setLastRun(null); setWindows([]); setPreflight([]); setRunning(true);
    try {
      setPhase(t("Verificación previa: una solicitud por objetivo…", "Preflight: one request per target…"));
      const edited = dataSource !== "seed" && dataSource !== "environment";
      const body = { environment: environmentId, type, baseRps, peakRps: usesPeak ? peakRps : baseRps, durationS, maxInFlight, timeoutMs, latency: { mode: latency.mode, ...(latency.mode === "custom" ? { p95Ms } : {}) }, onPreflightFailure: policy, locale, ...(mixId !== "custom" ? { mixId } : { targets }), ...(edited ? { data: Object.fromEntries(dataKeys.map((key) => [key, parseList(data[key])])) } : {}) };
      const started = await API.startLoadRun(project.id, body);
      runningId.current = started.id;
      await follow(started.id);
      const saved = await API.run(started.id);
      if (saved.status === "error") throw new Error(saved.error ?? t("La prueba falló", "The test failed"));
      const report = saved.report as { preflight?: PreflightResult[] } | null;
      if (report?.preflight) setPreflight(report.preflight);
      const run = loadRunToRecord(saved, { name: environmentName, baseUrl }, mixLabel);
      if (run) setLastRun(run);
      if (saved.status === "cancelled") setError(t("Prueba detenida: sin veredicto. Las solicitudes en vuelo terminaron del lado del servidor.", "Test stopped: no verdict. The requests in flight finished on the server side."));
      await client.invalidateQueries({ queryKey: KEYS.runs(project.id, "load") });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.full : failure instanceof Error ? failure.message : t("La prueba falló", "The test failed"));
    } finally {
      setRunning(false);
      setPhase("");
      runningId.current = null;
    }
  }

  const historyQuery = useQuery({ queryKey: KEYS.runs(project.id, "load"), queryFn: () => API.runs(project.id, "load"), enabled: Boolean(project.id) });
  const history = useMemo(() => (historyQuery.data ?? []).map((run) => loadRunToRecord(run, environmentOf(run.environmentId), mixLabel)).filter((run): run is LoadRun => Boolean(run)), [historyQuery.data, environmentOf, mixLabel]);
  const removeRun = async (id: string) => { await API.deleteRun(id).catch(() => {}); await client.invalidateQueries({ queryKey: KEYS.runs(project.id, "load") }); };

  return {
    environmentName, baseUrl, remote, catalog, mixes, dataKeys, projectId: project.id,
    type, chooseType, mixId, chooseMix, targets, editTargets, updateTarget, toggleCatalog,
    data, setData, dataSource, setDataSource, loadEnvironmentData, loadingData, missingData,
    baseRps, setBaseRps, peakRps, setPeakRps, durationS, setDurationS, maxInFlight, setMaxInFlight, timeoutMs, setTimeoutMs,
    latencyChoice, setLatencyChoice, p95Ms, setP95Ms, latency, budget, policy, setPolicy, confirmed, setConfirmed,
    usesPeak, stages, duration, requests,
    running, phase, windows, preflight, error, setError, lastRun, dismissLastRun: () => setLastRun(null),
    start, stop: () => { if (runningId.current) void API.cancelRun(runningId.current).catch(() => {}); },
    history,
    deleteRun: (id: string) => { void removeRun(id); },
    clearHistory: () => { void Promise.all(history.map((run) => API.deleteRun(run.id).catch(() => {}))).then(() => client.invalidateQueries({ queryKey: KEYS.runs(project.id, "load") })); },
  };
}
