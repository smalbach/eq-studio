/**
 * What a project is, without any framework: how its configuration is split for storage and put
 * back together, which sections can be edited one by one, and when it is valid.
 */
import { validateProject, type LoadConfig, type ProjectConfig, type ProjectOperation } from "@eq/runner-core";
import type { StoredConfig } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";

/** The sections of a configuration that are edited independently, each replaced whole. */
export const CONFIG_SECTIONS = ["implemented", "bodies", "responseShapes", "operationKinds", "parameterSamples", "defaultSample", "ids", "operationScenarios", "extraScenarios", "plugins", "auth", "budgets", "envelope", "bulk", "seed", "load"] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];

export function slugify(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
}

/** A full configuration out of what is stored: the operations come from the active spec version. */
export function assembleConfig(name: string, stored: StoredConfig, operations: ProjectOperation[], contractVersion?: string | null): ProjectConfig {
  return { name, ...(contractVersion ? { contractVersion } : {}), operations, ...stored };
}

/** What is stored of a configuration: everything but its name, version and operations. */
export function storedPart(config: ProjectConfig): StoredConfig {
  const stored: Record<string, unknown> = { ...config };
  for (const key of ["name", "contractVersion", "operations"]) delete stored[key];
  return stored as StoredConfig;
}

/** Replaces one section; `null` removes it. Returns the new stored config and load profile. */
export function applySection(stored: StoredConfig, load: LoadConfig | null, section: ConfigSection, value: unknown): { stored: StoredConfig; load: LoadConfig | null } {
  if (section === "load") return { stored, load: value === null ? null : value as LoadConfig };
  const next = { ...stored } as Record<string, unknown>;
  if (value === null) delete next[section];
  else next[section] = value;
  return { stored: next as StoredConfig, load };
}

/** Throws a 422 listing every problem when the configuration would not run. */
export function assertValid(config: ProjectConfig) {
  const errors = validateProject(config);
  // A project whose contract is not imported yet has no operations, and that is fine to store.
  const relevant = config.operations.length ? errors : errors.filter((error) => !error.startsWith("project.operations"));
  if (relevant.length) throw new Invalid("The project configuration is not valid", relevant);
}
