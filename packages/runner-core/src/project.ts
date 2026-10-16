/**
 * From a project's configuration to the endpoints the dashboard lists and runs.
 */
import { localized } from "./i18n.mjs";
import type { ContractOperation, Endpoint, Locale, OperationKind, ProjectConfig, ScenarioTemplate, TestScenario } from "./types.ts";

export const DEFAULT_EXISTING_ID = "1";
export const DEFAULT_MISSING_ID = "999999";
export const DEFAULT_SAMPLE = "test";

export function existingId(config: ProjectConfig) {
  return config.ids?.existing ?? DEFAULT_EXISTING_ID;
}

export function missingId(config: ProjectConfig) {
  return config.ids?.missing ?? DEFAULT_MISSING_ID;
}

export function dataKey(config: ProjectConfig) {
  return config.envelope?.dataKey ?? "data";
}

/** The names of the path placeholders, in order: `/a/{x}/b/{y}` → `["x", "y"]`. */
export function pathParameters(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

/**
 * What the generator does with an operation. By method and path, unless the project says
 * otherwise: a GET whose last segment is a placeholder reads one resource, any other GET lists;
 * a POST to `…/bulk` is a bulk.
 */
export function operationKind(operation: ContractOperation, config: ProjectConfig): OperationKind {
  const declared = config.operationKinds?.[operation.id];
  if (declared) return declared;
  if (operation.method === "GET") return operation.path.split("/").pop()?.startsWith("{") ? "detail" : "list";
  if (operation.method === "POST") return operation.path.endsWith("/bulk") ? "bulk" : "create";
  if (operation.method === "PUT") return "replace";
  if (operation.method === "PATCH") return "patch";
  return "delete";
}

function defaultResponseShape(operation: ContractOperation, config: ProjectConfig) {
  if (operation.method === "DELETE") return "No body";
  const key = dataKey(config);
  const kind = operationKind(operation, config);
  if (!key) return kind === "list" ? "[...]" : "Resource";
  return kind === "list" ? `{ ${key}: [...], meta, links }` : `{ ${key}: Resource }`;
}

export function buildEndpoints(config: ProjectConfig): Endpoint[] {
  const implemented = config.implemented ? new Set(config.implemented) : undefined;
  return config.operations.map(({ internal, ...operation }) => ({
    ...operation,
    internal: Boolean(internal),
    implemented: implemented ? implemented.has(operation.id) : true,
    responseShape: config.responseShapes?.[operation.id] ?? defaultResponseShape(operation, config),
    ...config.bodies?.[operation.id],
  }));
}

/** A project's scenario, in the language of the run. */
export function fromTemplate(template: ScenarioTemplate, locale: Locale): TestScenario {
  return { ...template, name: localized(locale, template.name), description: localized(locale, template.description) };
}
