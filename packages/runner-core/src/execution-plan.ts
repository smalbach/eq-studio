/**
 * The queue a run executes, and the order it executes it in.
 *
 * Three orders: the contract's own, a **safe** one, and one chosen by hand. The safe order runs
 * reads first — they are the only cases that assert without changing anything, so a red read
 * says something about that endpoint and not about a write that ran before it — and **deletes
 * last**. A DELETE is the only operation whose failure mode is destroying the data the rest of
 * the matrix reads: an authorization case that is wrongly authorized, or a delete with a wrong
 * cascade, takes rows other endpoints depend on. Running deletes last does not prevent that; it
 * stops it from being contagious, so a red DELETE at the end is a finding and not an avalanche.
 */
import { runnableScenarios } from "./scenarios.ts";
import type { Endpoint, HttpMethod, Locale, ProjectConfig, TestScenario } from "./types.ts";

export type OrderMode = "contract" | "safe" | "custom";
export type QueueItem = { endpoint: Endpoint; scenario: TestScenario };
/** Which cases of each endpoint a run includes. A key that is absent means *all* of them; an
 * empty array means the endpoint was explicitly emptied and contributes nothing. */
export type CaseSelection = Record<string, string[]>;

export const ORDER_MODES: OrderMode[] = ["contract", "safe", "custom"];

const methodRank: Record<HttpMethod, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };

export function orderEndpoints(list: Endpoint[], mode: OrderMode, customOrder: string[]): Endpoint[] {
  const contractIndex = new Map(list.map((endpoint, index) => [endpoint.id, index]));
  const contractRank = (endpoint: Endpoint) => contractIndex.get(endpoint.id) ?? list.length;
  if (mode === "contract") return [...list];
  if (mode === "safe") return [...list].sort((a, b) => methodRank[a.method] - methodRank[b.method] || contractRank(a) - contractRank(b));
  // An id the custom order never mentions is not dropped: it keeps the contract order, placed
  // after everything that was ordered by hand.
  const position = new Map(customOrder.map((id, index) => [id, index]));
  const customRank = (endpoint: Endpoint) => position.get(endpoint.id) ?? customOrder.length + contractRank(endpoint);
  return [...list].sort((a, b) => customRank(a) - customRank(b));
}

/** Swaps one endpoint with its neighbour. Out-of-range moves return the same array so the
 * caller can bind the arrows unconditionally. */
export function moveEndpoint(order: string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function selectedCases(endpoint: Endpoint, config: ProjectConfig, selection: CaseSelection, authEnabled: boolean, locale: Locale = "es"): TestScenario[] {
  const all = runnableScenarios(endpoint, config, authEnabled, locale);
  const picked = selection[endpoint.id];
  return picked ? all.filter((scenario) => picked.includes(scenario.id)) : all;
}

/**
 * The flat list of cases a run walks, endpoint by endpoint in the chosen order. `endpointIds`
 * is the subset to include; `undefined` means every endpoint of the list.
 */
export function buildQueue(list: Endpoint[], config: ProjectConfig, options: { mode: OrderMode; customOrder: string[]; endpointIds?: string[]; caseSelection: CaseSelection; authEnabled: boolean; locale?: Locale }): QueueItem[] {
  const included = options.endpointIds ? new Set(options.endpointIds) : undefined;
  return orderEndpoints(list, options.mode, options.customOrder)
    .filter((endpoint) => !included || included.has(endpoint.id))
    .flatMap((endpoint) => selectedCases(endpoint, config, options.caseSelection, options.authEnabled, options.locale).map((scenario) => ({ endpoint, scenario })));
}
