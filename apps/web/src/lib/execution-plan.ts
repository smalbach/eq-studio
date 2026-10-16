/** The queue of a run over the active project: the engine's plan bound to its configuration. */
import { buildQueue as buildQueueFor, selectedCases as selectedCasesFor, type CaseSelection, type Endpoint, type Locale, type OrderMode, type QueueItem, type TestScenario } from "@eq/runner-core";
import { getProject } from "@/lib/project-store";

export { moveEndpoint, orderEndpoints, ORDER_MODES } from "@eq/runner-core";
export type { CaseSelection, OrderMode, QueueItem } from "@eq/runner-core";

export function selectedCases(endpoint: Endpoint, selection: CaseSelection, authEnabled: boolean, locale: Locale = "es"): TestScenario[] {
  return selectedCasesFor(endpoint, getProject().file.project, selection, authEnabled, locale);
}

export function buildQueue(list: Endpoint[], options: { mode: OrderMode; customOrder: string[]; endpointIds?: string[]; caseSelection: CaseSelection; authEnabled: boolean; locale?: Locale }): QueueItem[] {
  return buildQueueFor(list, getProject().file.project, options);
}
