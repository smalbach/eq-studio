import { useMemo, useState } from "react";
import { useEndpoints, type Endpoint } from "@/lib/endpoints";
import { useProject } from "@/lib/project-store";
import { runnableScenarios, scenariosFor, type TestScenario } from "@/lib/scenarios";
import { buildQueue, orderEndpoints, selectedCases, ORDER_MODES, type CaseSelection, type OrderMode } from "@/lib/execution-plan";
import { pick } from "@/lib/settings.mjs";
import { defaultsFor } from "@/components/functional/use-functional-runner";
import { useLocale } from "@/lib/i18n";

export type RequestTab = "request" | "expected" | "actual";
export type Workbench = ReturnType<typeof useWorkbench>;

const bodyOf = (value: unknown) => value ? JSON.stringify(value, null, 2) : "";

const NO_ENDPOINT: Endpoint = { id: "", method: "GET", path: "", summary: "", tag: "", statuses: [], parameters: [], implemented: false, internal: false, responseShape: "" };

/** The tag filter's "every tag" value. An id, not a label: it is saved with the settings. */
export const ALL_TAGS = "Todos";

/**
 * What the verification screen has selected: the endpoint and case on screen with its editable
 * parameters and body, the endpoints and cases ticked for a run, and the order the queue runs in.
 *
 * Kept in the shell and not in the screen, so leaving to look at a run and coming back finds
 * everything as it was — and a running suite can keep moving the selection along.
 */
export function useWorkbench(authEnabled: boolean) {
  const locale = useLocale();
  const project = useProject();
  const endpoints = useEndpoints();
  const [selectedId, setSelectedId] = useState(endpoints[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState(ALL_TAGS);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [activeTab, setActiveTab] = useState<RequestTab>("actual");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  // The subset a run covers. Empty selection is not "everything": the two matrix buttons already
  // cover everything, and a subset button that silently means the whole matrix is how a
  // 45-operation write run gets started by accident.
  const [selectedEndpointIds, setSelectedEndpointIds] = useState<string[]>([]);
  const [caseSelection, setCaseSelection] = useState<CaseSelection>({});
  // Not the contract order: there a DELETE can run before the GET of the same path. See the
  // header of `packages/runner-core/src/execution-plan.ts`.
  const [orderMode, setOrderMode] = useState<OrderMode>("safe");
  const [customOrder, setCustomOrder] = useState<string[]>(() => endpoints.map((item) => item.id));
  // A different project has different endpoints: the selection starts over.
  const [projectId, setProjectId] = useState(project.id);
  if (projectId !== project.id) {
    setProjectId(project.id);
    setSelectedId(endpoints[0]?.id ?? ""); setSelectedScenarioId(""); setTag(ALL_TAGS); setSearch("");
    setSelectedEndpointIds([]); setCaseSelection({}); setCustomOrder(endpoints.map((item) => item.id)); setParameterValues({}); setBodyText("");
  }

  // Before the project loads there is no endpoint; the screens that read `selected` only render
  // once it has.
  const selected = endpoints.find((item) => item.id === selectedId) ?? endpoints[0] ?? NO_ENDPOINT;
  const scenarios = selected === NO_ENDPOINT ? [] : runnableScenarios(selected, authEnabled, locale);
  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const activeCases = selected === NO_ENDPOINT ? [] : selectedCases(selected, caseSelection, authEnabled, locale);
  const tags = useMemo(() => [ALL_TAGS, ...Array.from(new Set(endpoints.map((item) => item.tag)))], [endpoints]);
  const filtered = useMemo(() => endpoints.filter((item) => (tag === ALL_TAGS || item.tag === tag) && `${item.method} ${item.path} ${item.summary}`.toLowerCase().includes(search.toLowerCase())), [endpoints, search, tag]);
  const orderedEndpoints = useMemo(() => orderEndpoints(endpoints, orderMode, customOrder), [endpoints, orderMode, customOrder]);
  const selectionQueue = useMemo(() => buildQueue(endpoints, { mode: orderMode, customOrder, endpointIds: selectedEndpointIds, caseSelection, authEnabled, locale }), [endpoints, orderMode, customOrder, selectedEndpointIds, caseSelection, authEnabled, locale]);
  const matrixQueue = (scope: "read" | "all") => buildQueue(endpoints.filter((endpoint) => scope === "all" || endpoint.method === "GET"), { mode: orderMode, customOrder, caseSelection, authEnabled, locale });

  const selectEndpoint = (item: Endpoint, hasResult: boolean) => { setSelectedId(item.id); setSelectedScenarioId(""); setParameterValues(defaultsFor(item)); setBodyText(bodyOf(item.body)); setActiveTab(hasResult ? "actual" : "request"); };
  const selectAllScenarios = (hasResult: boolean) => { setSelectedScenarioId(""); setParameterValues(defaultsFor(selected)); setBodyText(bodyOf(selected.body)); setActiveTab(hasResult ? "actual" : "request"); };
  const selectScenario = (scenario: TestScenario, hasResult: boolean) => { setSelectedScenarioId(scenario.id); setParameterValues({ ...defaultsFor(selected), ...(scenario.parameters ?? {}) }); setBodyText(bodyOf(scenario.body ?? selected.body)); setActiveTab(hasResult ? "actual" : "request"); };
  /** Puts a case on screen, as a run reaches it or as a saved run asks to rerun it. */
  const openCase = (endpointId: string, scenarioId: string) => {
    const endpoint = endpoints.find((item) => item.id === endpointId);
    if (!endpoint) return;
    const scenario = scenariosFor(endpoint, locale).find((item) => item.id === scenarioId);
    setSelectedId(endpoint.id); setSelectedScenarioId(scenarioId);
    setParameterValues({ ...defaultsFor(endpoint), ...(scenario?.parameters ?? {}) });
    setBodyText(bodyOf(scenario?.body ?? endpoint.body));
    setActiveTab("actual");
  };
  const followCase = (endpointId: string, scenarioId: string) => { setSelectedId(endpointId); setSelectedScenarioId(scenarioId); };

  const toggleEndpoint = (id: string) => setSelectedEndpointIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectVisible = () => setSelectedEndpointIds((current) => Array.from(new Set([...current, ...filtered.map((item) => item.id)])));
  const clearSelection = () => setSelectedEndpointIds([]);
  const toggleCase = (endpoint: Endpoint, scenarioId: string) => setCaseSelection((current) => {
    const all = runnableScenarios(endpoint, authEnabled).map((scenario) => scenario.id);
    const picked = current[endpoint.id] ?? all;
    const next = picked.includes(scenarioId) ? picked.filter((id) => id !== scenarioId) : all.filter((id) => picked.includes(id) || id === scenarioId);
    // Back to the full list means "no restriction", not "a restriction that happens to match":
    // otherwise a case added later to `scenarios.ts` would be silently excluded from the run.
    if (next.length === all.length) { const rest = { ...current }; delete rest[endpoint.id]; return rest; }
    return { ...current, [endpoint.id]: next };
  });
  const changeOrderMode = (mode: OrderMode) => {
    // Switching to custom seeds the list with what is on screen, so "reads first, but the health
    // check last" is two clicks and not one arrow per endpoint.
    if (mode === "custom") setCustomOrder(orderedEndpoints.map((item) => item.id));
    setOrderMode(mode);
  };

  const snapshot = { project: project.id, selectedId, tag, orderMode, customOrder, selectedEndpointIds, caseSelection };
  const restore = (saved: Record<string, unknown>) => {
    // The selection belongs to the project it was made in.
    if (pick(saved, "workbenchProject", pick(saved, "project", "")) !== project.id) return;
    const known = new Set(endpoints.map((item) => item.id));
    const savedId = pick(saved, "selectedId", "");
    if (known.has(savedId)) setSelectedId(savedId);
    setTag(pick(saved, "tag", ALL_TAGS));
    const savedMode = pick(saved, "orderMode", "safe");
    setOrderMode(ORDER_MODES.includes(savedMode as OrderMode) ? savedMode as OrderMode : "safe");
    // An id the contract no longer has is dropped; one it gained since is placed by
    // `orderEndpoints` after the ones ordered by hand.
    setCustomOrder(pick(saved, "customOrder", [] as string[]).filter((id) => known.has(id)));
    setSelectedEndpointIds(pick(saved, "selectedEndpointIds", [] as string[]).filter((id) => known.has(id)));
    setCaseSelection(pick(saved, "caseSelection", {} as CaseSelection));
  };

  return {
    selected, scenarios, selectedScenario, activeCases, tags, filtered, orderedEndpoints, selectionQueue, matrixQueue,
    search, setSearch, tag, setTag, parameterValues, setParameterValues, bodyText, setBodyText, activeTab, setActiveTab,
    selectedEndpointIds, caseSelection, orderMode, customOrder, setCustomOrder,
    selectEndpoint, selectAllScenarios, selectScenario, openCase, followCase,
    toggleEndpoint, selectVisible, clearSelection, toggleCase, changeOrderMode,
    snapshot, restore,
  };
}
