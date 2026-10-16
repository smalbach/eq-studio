/**
 * From a case to the request it sends: its path with placeholders and query filled, its body,
 * the seed's ids mapped onto the environment's rows, the budget that applies to it.
 */
import { budgetFor } from "./budgets.mjs";
import { executeCase, type CaseRequest, type CaseResult } from "./execute.ts";
import { dataKey, existingId, pathParameters } from "./project.ts";
import { remapBodyIds, remapSeedIds } from "./seed-ids.mjs";
import type { Endpoint, Locale, ProjectConfig, TestScenario } from "./types.ts";

/** The defaults an endpoint takes: **only its path placeholders**, each the seed's existing id.
 * Merged with query parameters too, an unfiltered list would go out filtered. */
export function defaultsFor(endpoint: Endpoint, config: ProjectConfig) {
  return Object.fromEntries(pathParameters(endpoint.path).map((name) => [name, existingId(config)]));
}

export function resolvePath(endpoint: Endpoint, values: Record<string, string>, config?: ProjectConfig) {
  const fallback = config ? existingId(config) : "1";
  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_, key: string) => encodeURIComponent(values[key] || fallback));
  const query = new URLSearchParams();
  endpoint.parameters?.filter((name) => !endpoint.path.includes(`{${name}}`) && values[name]).forEach((name) => query.set(name, values[name]));
  return query.size ? `${path}?${query}` : path;
}

/** Remaps the seed's ids in a body, as the project declares which fields hold them. */
export function remapBody(body: unknown, lists: Record<string, string[]>, config: ProjectConfig) {
  return remapBodyIds(body, lists, { fields: config.seed?.bodyIdFields ?? [], nested: [config.bulk?.recordsKey ?? "records"], rows: config.seed?.mappedRows });
}

export function remapParameters(values: Record<string, string>, lists: Record<string, string[]>, config: ProjectConfig) {
  return remapSeedIds(values, lists, config.seed?.mappedRows);
}

/** What the response must look like when the document declares no schema for it. */
export function responseShapeFor(endpoint: Endpoint, scenario: TestScenario) {
  return scenario.expectedStatus >= 400 ? "ProblemDetails" : endpoint.responseShape;
}

export type ExecutionEnvironment = {
  baseUrl: string;
  specUrl?: string;
  specHeaders?: Record<string, string>;
  /** The headers a case authenticates with, by how it is meant to authenticate. */
  credentialsFor: (scenario: TestScenario) => Record<string, string>;
  /** Existing ids discovered in the environment; empty in the seed itself. */
  lists?: Record<string, string[]>;
  samples?: number;
  enforceLatency?: boolean;
  locale?: Locale;
};

/** The full request of one case, ready for `executeCase`. */
export function caseRequest(config: ProjectConfig, env: ExecutionEnvironment, endpoint: Endpoint, scenario: TestScenario, parameterOverrides: Record<string, string> = {}, body?: unknown): CaseRequest {
  const lists = env.lists ?? {};
  const path = resolvePath(endpoint, { ...remapParameters({ ...defaultsFor(endpoint, config), ...(scenario.parameters ?? {}) }, lists, config), ...parameterOverrides }, config);
  return {
    baseUrl: env.baseUrl,
    method: endpoint.method,
    path,
    operationPath: endpoint.path,
    expectedStatus: scenario.expectedStatus,
    body: body === undefined ? remapBody(scenario.body, lists, config) : body,
    headers: env.credentialsFor(scenario),
    specHeaders: env.specHeaders,
    specUrl: env.specUrl,
    responseShape: responseShapeFor(endpoint, scenario),
    envelopeKey: dataKey(config),
    samples: env.samples,
    internal: endpoint.internal,
    budget: budgetFor(config.budgets ?? [], endpoint.method, endpoint.path, path, env.locale),
    enforceLatency: env.enforceLatency,
    locale: env.locale,
  };
}

/**
 * An `Execute` for `createScenarioRunner` that sends each case straight to the API. The
 * dashboard routes the same `CaseRequest` through its own server instead; a script or a test
 * uses this one.
 */
export function directExecutor(config: ProjectConfig, env: ExecutionEnvironment, fetchImpl: typeof fetch = fetch) {
  return (endpoint: Endpoint, scenario: TestScenario, parameterOverrides: Record<string, string> = {}, options: { body?: Record<string, unknown> } = {}): Promise<CaseResult> =>
    executeCase(caseRequest(config, env, endpoint, scenario, parameterOverrides, options.body), fetchImpl);
}
