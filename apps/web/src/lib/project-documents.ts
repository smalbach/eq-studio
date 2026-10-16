/**
 * Reading what a new project is made from: an OpenAPI document (JSON or YAML) or a project file,
 * and the base URL and document path its first environment gets.
 */
import { parse as parseYaml } from "yaml";

/** A document as JSON or YAML: OpenAPI documents come in both. */
export function parseDocument(text: string): unknown {
  const trimmed = text.trim();
  return trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
}

/** What a document is: an OpenAPI 3 contract, a project file, or neither. */
export function documentKind(document: unknown): "openapi" | "project" | null {
  const record = document as Record<string, unknown> | null;
  if (record?.format === "endpoint-quality/project") return "project";
  if (typeof record?.openapi === "string" && record.openapi.startsWith("3.")) return "openapi";
  return null;
}

/** The base URL an OpenAPI document declares, or the origin it was read from. */
export function baseUrlOf(spec: unknown, specUrl?: string) {
  const servers = (spec as { servers?: { url?: string }[] })?.servers;
  const declared = servers?.find((server) => typeof server.url === "string")?.url;
  try { if (declared) return new URL(declared, specUrl).toString().replace(/\/$/, ""); } catch { /* a relative server with nothing to resolve it against */ }
  try { return specUrl ? new URL(specUrl).origin : ""; } catch { return ""; }
}

/** The path of the document under the base URL, so each run reads the same one. */
export function specPathFor(specUrl: string | undefined, baseUrl: string) {
  if (!specUrl) return undefined;
  return specUrl.startsWith(baseUrl) ? specUrl.slice(baseUrl.length) || "/" : specUrl;
}
