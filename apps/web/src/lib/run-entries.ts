/** A saved run rebuilt into the `(endpoint, case, result)` entries every summary reads. */
import { getEndpoints } from "@/lib/endpoints";
import { scenariosFor } from "@/lib/scenarios";
import { resultFromSnapshot } from "@/lib/run-snapshot.mjs";
import type { Locale } from "@/lib/i18n";
import type { RunEntry, RunRecord, ScenarioResultLike } from "@/lib/run-types";

/** `locale` is the language of the case name; the saved run only keeps ids. */
export function resolveCase(endpointId: string, scenarioId: string, locale: Locale = "es") {
  const endpoint = getEndpoints().find((item) => item.id === endpointId);
  const scenario = endpoint ? scenariosFor(endpoint, locale).find((item) => item.id === scenarioId) : undefined;
  return endpoint && scenario ? { endpoint, scenario } : undefined;
}

export function splitCaseKey(key: string) {
  const separator = key.indexOf(":");
  return { endpointId: key.slice(0, separator), scenarioId: key.slice(separator + 1) };
}

/** A case key as a person reads it: method, path and the case's name. */
export function caseName(key: string, locale: Locale = "es") {
  const { endpointId, scenarioId } = splitCaseKey(key);
  const found = resolveCase(endpointId, scenarioId, locale);
  return { endpointId, scenarioId, label: found ? `${found.endpoint.method} ${found.endpoint.path}` : endpointId, scenario: found?.scenario.name ?? scenarioId };
}

export function entriesOfRun(run: RunRecord, locale: Locale = "es"): RunEntry[] {
  if (!run.cases) return [];
  const origin = (() => { try { return new URL(run.baseUrl).origin; } catch { return ""; } })();
  return run.cases.flatMap((item) => { const found = resolveCase(item.e, item.s, locale); return found ? [{ ...found, result: resultFromSnapshot(item, origin) as ScenarioResultLike }] : []; });
}

/** The run before this one in the same environment, with cases to compare against. */
export function previousRun(runs: RunRecord[], run: RunRecord) {
  return runs.slice(runs.indexOf(run) + 1).find((item) => item.cases?.length && item.environment === run.environment);
}

export const passRate = (run: Pick<RunRecord, "passed" | "total">) => run.total ? run.passed / run.total : 0;
