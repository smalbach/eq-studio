/**
 * Reading and checking a project file. A file comes from an example, an export, another
 * machine or a hand edit, so nothing in it is trusted to have the right shape until checked.
 */
import type { EnvironmentConfig, ProjectConfig, ProjectFile } from "./types.ts";

export const PROJECT_FORMAT = "endpoint-quality/project";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Every problem with a project configuration, as `path: message`. Empty when it is usable. */
export function validateProject(project: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(project)) return ["project: must be an object"];
  if (typeof project.name !== "string" || !project.name.trim()) errors.push("project.name: required");
  if (!Array.isArray(project.operations)) return [...errors, "project.operations: must be a list"];
  if (!project.operations.length) errors.push("project.operations: the project declares no operation");
  const ids = new Set<string>();
  project.operations.forEach((operation, index) => {
    const at = `project.operations[${index}]`;
    if (!isRecord(operation)) { errors.push(`${at}: must be an object`); return; }
    if (typeof operation.id !== "string" || !operation.id) errors.push(`${at}.id: required`);
    else if (ids.has(operation.id)) errors.push(`${at}.id: duplicate "${operation.id}"`);
    else ids.add(operation.id);
    if (!METHODS.includes(String(operation.method))) errors.push(`${at}.method: one of ${METHODS.join(", ")}`);
    if (typeof operation.path !== "string" || !operation.path.startsWith("/")) errors.push(`${at}.path: must start with /`);
    if (!Array.isArray(operation.statuses) || operation.statuses.some((status) => !Number.isInteger(status))) errors.push(`${at}.statuses: list of HTTP statuses`);
    if (!Array.isArray(operation.parameters)) errors.push(`${at}.parameters: list of names`);
  });
  for (const key of ["bodies", "responseShapes", "operationKinds", "operationScenarios", "extraScenarios", "requestSchemas"] as const) {
    const map = project[key];
    if (map === undefined) continue;
    if (!isRecord(map)) { errors.push(`project.${key}: must be an object keyed by operationId`); continue; }
    for (const id of Object.keys(map)) if (!ids.has(id)) errors.push(`project.${key}.${id}: no such operation`);
  }
  if (project.budgets !== undefined && !Array.isArray(project.budgets)) errors.push("project.budgets: must be a list of rules");
  const negative = project.negativeCases;
  if (negative !== undefined) {
    if (!isRecord(negative)) errors.push("project.negativeCases: must be an object");
    else {
      if (negative.enabled !== undefined && typeof negative.enabled !== "boolean") errors.push("project.negativeCases.enabled: true or false");
      if (negative.maxPerOperation !== undefined && (!Number.isInteger(negative.maxPerOperation) || Number(negative.maxPerOperation) < 0)) errors.push("project.negativeCases.maxPerOperation: a whole number, 0 or more");
      if (negative.exclude !== undefined && !Array.isArray(negative.exclude)) errors.push("project.negativeCases.exclude: list of operationIds");
      else for (const id of (negative.exclude as unknown[] | undefined) ?? []) if (!ids.has(String(id))) errors.push(`project.negativeCases.exclude: no such operation "${String(id)}"`);
      if (negative.statuses !== undefined && (!Array.isArray(negative.statuses) || negative.statuses.some((status) => !Number.isInteger(status) || status < 400 || status > 499))) errors.push("project.negativeCases.statuses: list of 4xx statuses");
    }
  }
  return errors;
}

export function validateEnvironment(environment: unknown, index = 0): string[] {
  const at = `environments[${index}]`;
  if (!isRecord(environment)) return [`${at}: must be an object`];
  const errors: string[] = [];
  if (typeof environment.id !== "string" || !environment.id) errors.push(`${at}.id: required`);
  if (typeof environment.name !== "string" || !environment.name) errors.push(`${at}.name: required`);
  try { const url = new URL(String(environment.baseUrl)); if (!["http:", "https:"].includes(url.protocol)) errors.push(`${at}.baseUrl: http or https`); } catch { errors.push(`${at}.baseUrl: not a URL`); }
  return errors;
}

/** Parses a project file, or throws with every problem found. A bare `ProjectConfig` is
 * accepted too, and gets no environments. */
export function parseProjectFile(input: unknown): ProjectFile {
  const value = typeof input === "string" ? JSON.parse(input) as unknown : input;
  const file = isRecord(value) && value.format === PROJECT_FORMAT ? value : { format: PROJECT_FORMAT, version: 1, project: value, environments: [] };
  const errors = validateProject(file.project);
  if (!Array.isArray(file.environments)) errors.push("environments: must be a list");
  else file.environments.forEach((environment, index) => errors.push(...validateEnvironment(environment, index)));
  if (errors.length) throw new Error(errors.slice(0, 12).join("\n"));
  return file as ProjectFile;
}

export function projectFile(project: ProjectConfig, environments: EnvironmentConfig[], load?: ProjectFile["load"]): ProjectFile {
  return { format: PROJECT_FORMAT, version: 1, project, environments, ...(load ? { load } : {}) };
}
