/** The test matrix of the active project: the engine's generator bound to its configuration. */
import { runnableScenarios as runnableFor, scenariosFor as scenariosOf, type Endpoint, type Locale, type TestScenario } from "@eq/runner-core";
import { getProject } from "@/lib/project-store";

export type { ScenarioAuth, ScenarioFlow, TestScenario } from "@eq/runner-core";

export function scenariosFor(endpoint: Endpoint, locale: Locale = "es"): TestScenario[] {
  return scenariosOf(endpoint, getProject().file.project, locale);
}

export function runnableScenarios(endpoint: Endpoint, authEnabled: boolean, locale: Locale = "es"): TestScenario[] {
  return runnableFor(endpoint, getProject().file.project, authEnabled, locale);
}
