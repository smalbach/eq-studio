/** The chained flows of the active project: the engine's runner bound to its configuration. */
import { createScenarioRunner as createRunner, type Endpoint, type Execute, type Locale, type StepResult } from "@eq/runner-core";
import { getProject } from "@/lib/project-store";

export type { Execute, StepResult } from "@eq/runner-core";

export function createScenarioRunner<R extends StepResult>(endpoints: Endpoint[], execute: Execute<R>, show: (endpointId: string, result: R) => void = () => {}, hasRows: (name: string) => boolean = () => true, locale: Locale = "es") {
  return createRunner(endpoints, getProject().file.project, execute, show, hasRows, locale);
}
