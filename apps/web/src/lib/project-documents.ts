/**
 * Reading what a new project is made from: a contract (OpenAPI 3, Swagger 2.0 or a Postman
 * collection, as JSON or YAML) or a project file, and the base URL and document path its first
 * environment gets.
 */
import { parse as parseYaml } from "yaml";
import { contractFormatOf, toOpenApi3 } from "@eq/runner-core";
import { parsePostmanEnvironment } from "./postman-environment.mjs";

/** A document as JSON or YAML: OpenAPI documents come in both. */
export function parseDocument(text: string): unknown {
  const trimmed = text.trim();
  return trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
}

export type DocumentKind = "openapi" | "swagger" | "postman" | "postman-environment" | "project";

/**
 * What a document is: a contract in one of the accepted formats, a project file, a Postman
 * environment (which only says where the API runs), or nothing this app reads.
 */
export function documentKind(document: unknown): DocumentKind | null {
  const record = document as Record<string, unknown> | null;
  if (record?.format === "endpoint-quality/project") return "project";
  const format = contractFormatOf(document);
  if (format) return format;
  if (Array.isArray(record?.values) && !record?.item) return "postman-environment";
  return null;
}

/**
 * The base URL a contract declares, or the origin it was read from. `variables` resolve a Postman
 * collection's `{{baseUrl}}` — the ones a Postman environment carries.
 */
export function baseUrlOf(spec: unknown, specUrl?: string, variables?: Record<string, string>) {
  let document = spec;
  try { if (contractFormatOf(spec) && contractFormatOf(spec) !== "openapi") document = toOpenApi3(spec, { variables }).document; } catch { /* read as it is */ }
  const servers = (document as { servers?: { url?: string }[] })?.servers;
  const declared = servers?.find((server) => typeof server.url === "string")?.url;
  try { if (declared) return new URL(declared, specUrl).toString().replace(/\/$/, ""); } catch { /* a relative server with nothing to resolve it against */ }
  try { return specUrl ? new URL(specUrl).origin : ""; } catch { return ""; }
}

/** The path of the document under the base URL, so each run reads the same one. */
export function specPathFor(specUrl: string | undefined, baseUrl: string) {
  if (!specUrl) return undefined;
  return specUrl.startsWith(baseUrl) ? specUrl.slice(baseUrl.length) || "/" : specUrl;
}

/**
 * Several files chosen at once: the contract (or project file), and the Postman environment that
 * may come with a collection. The environment gives the first environment its name and base URL.
 */
export async function readImportFiles(files: Iterable<File>, locale: "es" | "en") {
  let contract: { document: unknown; kind: DocumentKind; name: string } | null = null;
  let environment: { name: string; baseUrl?: string; variables: Record<string, string> } | null = null;
  for (const file of files) {
    const document = parseDocument(await file.text());
    const kind = documentKind(document);
    if (kind === "postman-environment") {
      const parsed = parsePostmanEnvironment(document, file.name.replace(/\.json$/i, ""), locale);
      environment = { name: parsed.name, baseUrl: (parsed.fields as { baseUrl?: string }).baseUrl, variables: parsed.variableValues };
    } else if (kind) contract = { document, kind, name: file.name };
    else throw new Error(locale === "en" ? `${file.name}: not an OpenAPI 3, Swagger 2.0, Postman collection or environment, nor a .eq.json file.` : `${file.name}: no es un OpenAPI 3, un Swagger 2.0, una colección o un entorno de Postman, ni un archivo .eq.json.`);
  }
  return { contract, environment };
}
