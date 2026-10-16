/**
 * From an OpenAPI 3.x document to a starting `ProjectConfig`.
 *
 * Everything the document states is taken from it: operations, declared statuses, parameters,
 * which operations need no credential, the envelope its list responses use. What it can only
 * suggest — request bodies, values to try per parameter, where existing ids come from — is
 * generated as a starting point the project then edits. Latency budgets are never invented: an
 * API without stated budgets gets no latency assertion until someone writes one.
 */
import { dereference } from "./contract.mjs";
import { toOpenApi3 } from "./contract-formats.ts";
import type { BudgetRule, GeoPlugin, HttpMethod, IdSource, ParameterSample, ProjectConfig, ProjectOperation } from "./types.ts";

type Json = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

const asRecord = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});

/** `GET /orders/{order_id}/items` → `getOrdersOrderIdItems`, for operations with no operationId. */
export function operationIdFor(method: string, path: string) {
  const words = path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

/** A plausible value for a schema: its example, its default, its first enum value, or one by type. */
export function sampleFor(schemaInput: unknown, depth = 0): unknown {
  const schema = asRecord(schemaInput);
  if ("const" in schema) return schema.const;
  if ("example" in schema) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const parts = schema[key];
    if (Array.isArray(parts) && parts.length) {
      if (key === "allOf") return Object.assign({}, ...parts.map((part) => sampleFor(part, depth)).filter((part) => part && typeof part === "object"));
      return sampleFor(parts.find((part) => asRecord(part).type !== "null") ?? parts[0], depth);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (type === "object" || (!type && schema.properties)) {
    if (depth > 4) return {};
    const properties = asRecord(schema.properties);
    const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : Object.keys(properties));
    return Object.fromEntries(Object.entries(properties)
      .filter(([name, property]) => required.has(name) && !asRecord(property).readOnly)
      .map(([name, property]) => [name, sampleFor(property, depth + 1)]));
  }
  if (type === "array") return depth > 4 ? [] : [sampleFor(schema.items, depth + 1)];
  if (type === "integer") return typeof schema.minimum === "number" ? Math.max(1, schema.minimum) : 1;
  if (type === "number") return typeof schema.minimum === "number" ? Math.max(1, schema.minimum) : 1;
  if (type === "boolean") return true;
  if (type === "string") {
    if (schema.format === "date-time") return "2030-01-01T00:00:00Z";
    if (schema.format === "date") return "2030-01-01";
    if (schema.format === "email") return "sample@example.com";
    if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000001";
    if (schema.format === "uri" || schema.format === "url") return "https://example.com";
    const minLength = typeof schema.minLength === "number" ? schema.minLength : 0;
    return "sample".padEnd(minLength, "x");
  }
  return null;
}

/** The non-null type of a schema: OpenAPI 3.1 writes a nullable string as `type: [string, "null"]`. */
const typeOf = (schema: Json) => Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;

function parameterSamples(schemaInput: unknown, invalidStatus: number | undefined): ParameterSample[] {
  const input = asRecord(schemaInput);
  const schema: Json = { ...input, type: typeOf(input) };
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum.slice(0, 3).map((value) => ({ value: String(value) }));
  if (schema.type === "boolean") return [{ value: "true" }, { value: "false" }];
  const samples: ParameterSample[] = [{ value: String(sampleFor(schema) ?? "sample") }];
  if (invalidStatus && (schema.type === "integer" || schema.type === "number")) {
    const outOfRange = { es: "Comprueba un valor fuera de rango.", en: "Checks an out-of-range value." };
    if (typeof schema.minimum === "number") samples.push({ value: String(schema.minimum - 1), expectedStatus: invalidStatus, description: outOfRange });
    if (typeof schema.maximum === "number") samples.push({ value: String(schema.maximum + 1), expectedStatus: invalidStatus, description: outOfRange });
  }
  return samples;
}

function jsonMediaOf(content: unknown) {
  const media = asRecord(content);
  return asRecord(media["application/json"] ?? Object.entries(media).find(([type]) => type.includes("json"))?.[1]);
}

const jsonSchemaOf = (content: unknown) => jsonMediaOf(content).schema;

export type ImportedProject = { config: ProjectConfig; warnings: string[] };

/** Any accepted contract — OpenAPI 3.x, Swagger 2.0, a Postman collection — converted to OpenAPI 3 first. */
export function projectFromOpenApi(input: unknown, options: { name?: string } = {}): ImportedProject {
  const normalized = toOpenApi3(input);
  const spec = normalized.document;
  const warnings: string[] = [...normalized.warnings];
  const info = asRecord(spec.info);
  const globalSecurity = Array.isArray(spec.security) ? spec.security : [];
  const operations: ProjectOperation[] = [];
  const bodies: NonNullable<ProjectConfig["bodies"]> = {};
  const samples: Record<string, ParameterSample[]> = {};
  const publicOperations: string[] = [];
  const seen = new Set<string>();
  const parameterSchemas: Record<string, unknown> = {};
  let envelopeVotes = 0;
  let listCount = 0;

  for (const [path, pathItemInput] of Object.entries(asRecord(spec.paths))) {
    const pathItem = asRecord(dereference(pathItemInput, spec));
    const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of METHODS) {
      const operation = asRecord(pathItem[method]);
      if (!pathItem[method]) continue;
      let id = typeof operation.operationId === "string" && operation.operationId ? operation.operationId : operationIdFor(method, path);
      if (seen.has(id)) { warnings.push(`Duplicate operationId ${id}`); id = operationIdFor(method, path); }
      seen.add(id);
      const parameters = [...shared, ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map(asRecord).filter((parameter) => parameter.in === "path" || parameter.in === "query");
      const statuses = Object.keys(asRecord(operation.responses)).filter((status) => /^\d{3}$/.test(status)).map(Number).sort((a, b) => a - b);
      const invalidStatus = statuses.includes(422) ? 422 : statuses.includes(400) ? 400 : undefined;
      for (const parameter of parameters) {
        const name = String(parameter.name);
        if (parameter.in === "query" && !samples[name]) { samples[name] = parameterSamples(parameter.schema, invalidStatus); parameterSchemas[name] = parameter.schema; }
      }
      const upper = method.toUpperCase() as HttpMethod;
      operations.push({ id, method: upper, path, summary: String(operation.summary ?? operation.description ?? `${upper} ${path}`).split("\n")[0], tag: Array.isArray(operation.tags) && operation.tags.length ? String(operation.tags[0]) : "default", statuses, parameters: [...new Set(parameters.map((parameter) => String(parameter.name)))] });
      const security = Array.isArray(operation.security) ? operation.security : globalSecurity;
      if (!security.length || security.some((requirement) => Object.keys(asRecord(requirement)).length === 0)) publicOperations.push(id);
      if (["post", "put", "patch"].includes(method)) {
        const media = jsonMediaOf(asRecord(dereference(operation.requestBody, spec)).content);
        if (media.schema) {
          // An example the contract gives for the whole body beats one generated from its schema.
          const generated = "example" in media ? media.example : sampleFor(dereference(media.schema, spec));
          if (generated && typeof generated === "object" && !Array.isArray(generated)) {
            const body = generated as Json;
            // A PATCH changes one thing: the first writable field is enough to prove it persists.
            const first = Object.keys(body)[0];
            bodies[id] = { body: method === "patch" && first ? { [first]: body[first] } : body };
          }
        }
      }
      if (method === "get" && !path.split("/").pop()?.startsWith("{")) {
        listCount += 1;
        const ok = asRecord(asRecord(operation.responses)["200"]);
        const schema = asRecord(jsonSchemaOf(ok.content));
        if (asRecord(schema.properties).data) envelopeVotes += 1;
      }
    }
  }

  const pagination = operations.some((operation) => operation.parameters.includes("cursor")) ? { cursorParam: "cursor", invalidValue: "%%invalid-cursor%%", expectedStatus: operations.some((operation) => operation.parameters.includes("cursor") && operation.statuses.includes(422)) ? 422 : 400 } : undefined;
  const geo = geoPlugin(operations, parameterSchemas);
  const dataKey = listCount > 0 && envelopeVotes * 2 >= listCount ? "data" : "";
  const budgets: BudgetRule[] = [];
  if (!operations.length) warnings.push("The document declares no operations.");
  return {
    warnings,
    config: {
      name: options.name ?? String(info.title ?? "API"),
      contractVersion: typeof info.version === "string" ? info.version : undefined,
      operations,
      bodies,
      parameterSamples: samples,
      plugins: { ...(pagination ? { pagination } : {}), ...(geo ? { geo } : {}) },
      auth: { publicOperations },
      budgets,
      envelope: { dataKey, idFallbackKey: "id" },
      seed: { sources: idSources(operations), mappedRows: 4 },
    },
  };
}

/**
 * A geographic search, when some list takes a latitude, a longitude and a radius together. Sent
 * one at a time those parameters are a half search the API should reject, so they are tested as
 * a trio instead. The center is the parameters' own example when they declare one.
 */
function geoPlugin(operations: ProjectOperation[], schemas: Record<string, unknown>): GeoPlugin | undefined {
  const find = (names: string[]) => (operation: ProjectOperation) => operation.parameters.find((name) => names.includes(name.toLowerCase()));
  for (const operation of operations) {
    const lat = find(["lat", "latitude"])(operation);
    const lon = find(["lon", "lng", "long", "longitude"])(operation);
    const radius = find(["radius", "radius_km", "radiuskm", "distance", "distance_km"])(operation);
    if (!lat || !lon || !radius) continue;
    const example = (name: string) => { const value = sampleFor(schemas[name]); return typeof value === "number" || typeof value === "string" ? String(value) : "0"; };
    return { lat, lon, radius, center: { lat: example(lat), lon: example(lon) }, radiiKm: ["1", "20"], loneRadiusKm: "5" };
  }
  return undefined;
}

/**
 * Where each id parameter's existing values can be read: the list operation of its collection.
 * `/orders/{order_id}` reads from `GET /orders`; a nested `/orders/{order_id}/items/{item_id}`
 * from `GET /orders/{order_id}/items`, once an order id is known.
 */
export function idSources(operations: ProjectOperation[]): IdSource[] {
  const sources: IdSource[] = [];
  const lists = new Set(operations.filter((operation) => operation.method === "GET").map((operation) => operation.path));
  const byDepth = [...operations].filter((operation) => operation.method === "GET" && operation.path.split("/").pop()?.startsWith("{")).sort((a, b) => a.path.split("{").length - b.path.split("{").length);
  for (const operation of byDepth) {
    const names = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const name = names.at(-1)!;
    const collection = operation.path.replace(/\/\{[^}]+\}$/, "");
    if (!lists.has(collection) || sources.some((source) => source.name === name)) continue;
    const needs = names.length > 1 ? names[names.length - 2] : undefined;
    if (names.length > 2) continue;
    sources.push({ name, path: `${collection}?limit=4`, operationPath: collection, ...(needs ? { needs } : {}) });
  }
  return sources;
}
