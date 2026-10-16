/**
 * An OpenAPI document as the product keeps it: parsed from JSON or YAML, identified by the hash
 * of its content, and flattened into operations by the engine's importer.
 *
 * A Swagger 2.0 document or a Postman collection is stored as the OpenAPI 3 it converts to, and
 * hashed as that. The conversion is deterministic, so the same original is still the same version.
 */
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { projectFromOpenApi, toOpenApi3, type ContractFormat, type ProjectOperation } from "@eq/runner-core";
import { Invalid } from "../../../shared/errors.ts";

export type ParsedSpec = { document: Record<string, unknown>; text: string; hash: string; operations: ProjectOperation[]; openapiVersion: string | null; title: string | null; version: string | null; warnings: string[]; sourceFormat: ContractFormat; baseUrl: string | null };

/** Key order does not change a document, so it does not change its hash either. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashOf(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function parseSpec(input: string | Record<string, unknown>): ParsedSpec {
  let document: unknown;
  try {
    document = typeof input === "string" ? (input.trim().startsWith("{") ? JSON.parse(input) : parseYaml(input)) : input;
  } catch (error) {
    throw new Invalid(`The document is neither JSON nor YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Invalid("The document is not an object");
  let imported;
  let normalized;
  try {
    normalized = toOpenApi3(document);
    imported = projectFromOpenApi(normalized.document);
  } catch (error) {
    throw new Invalid(error instanceof Error ? error.message : String(error));
  }
  const record = normalized.document;
  const servers = Array.isArray(record.servers) ? record.servers as { url?: unknown }[] : [];
  const declared = typeof servers[0]?.url === "string" && /^https?:\/\//.test(servers[0].url) ? servers[0].url.replace(/\/+$/, "") : null;
  const info = (record.info ?? {}) as Record<string, unknown>;
  return {
    document: record,
    text: JSON.stringify(record),
    hash: hashOf(record),
    operations: imported.config.operations,
    openapiVersion: typeof record.openapi === "string" ? record.openapi : null,
    title: typeof info.title === "string" ? info.title : null,
    version: typeof info.version === "string" ? info.version : null,
    warnings: [...normalized.warnings, ...imported.warnings],
    sourceFormat: normalized.format,
    baseUrl: normalized.baseUrl ?? declared,
  };
}
