/**
 * Generated configuration over an existing one. `replace` takes the generated sections whole;
 * `merge` keeps everything the project already says and only fills what is missing — a body for
 * a new operation, samples for a new parameter — so regenerating after a contract change never
 * throws away hand-tuned values.
 */
import type { StoredConfig } from "../../../database/entities.ts";

const MAPS = ["bodies", "parameterSamples", "responseShapes", "operationKinds", "operationScenarios", "extraScenarios"] as const;
/** Maps that only restate the contract: nothing in them is hand-tuned, so the new contract wins. */
const CONTRACT_MAPS = ["requestSchemas"] as const;

export function mergeGenerated(current: StoredConfig, generated: StoredConfig, mode: "merge" | "replace"): StoredConfig {
  if (mode === "replace") return { ...current, ...generated };
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(generated)) {
    if (next[key] === undefined) { next[key] = value; continue; }
    if ((MAPS as readonly string[]).includes(key) && value && typeof value === "object") next[key] = { ...(value as object), ...(next[key] as object) };
    else if ((CONTRACT_MAPS as readonly string[]).includes(key) && value && typeof value === "object") next[key] = { ...(next[key] as object), ...(value as object) };
  }
  return next as StoredConfig;
}
