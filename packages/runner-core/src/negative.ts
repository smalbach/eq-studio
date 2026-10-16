/**
 * The negative cases: input the contract says is wrong, sent one fault at a time, that the API
 * must reject with a 4xx. A 2xx means it accepted what it should not have; a 5xx means the bad
 * input reached code that was never meant to see it. Either is a finding, and both are what an
 * API under real clients answers first.
 *
 * Generated from the operation's input schemas (`requestSchemas`, taken from the OpenAPI
 * document on import), over the operation's own valid fixture body, so the fault under test is
 * the only one in the request. Deterministic and bounded: kinds are taken one at a time in a
 * fixed order — one of each before a second of any — up to a cap per operation.
 */
import { tr } from "./i18n.mjs";
import { sampleFor } from "./openapi.ts";
import { existingId, pathParameters } from "./project.ts";
import type { Endpoint, Locale, NegativeKind, ProjectConfig, TestScenario } from "./types.ts";

type Json = Record<string, unknown>;

export const DEFAULT_NEGATIVE_CAP = 10;
/** Statuses that are not a verdict on the input: the credential, the method, the state of the
 * data, the rate. A negative case answered with one of them has not been validated at all. */
const NOT_VALIDATION = new Set([401, 403, 405, 409, 429]);
/** The order kinds are taken in, so a small cap still covers the widest spread. */
const KIND_ORDER: NegativeKind[] = ["malformed", "missing", "type", "null", "min-length", "max-length", "minimum", "maximum", "enum", "format", "extra"];
/** Longer than this, a max-length case would be a payload test, not a validation one. */
const MAX_GENERATED_LENGTH = 10_000;
const EXTRA_MEMBER = "eq_unexpected_field";

const asRecord = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const typesOf = (schema: Json): string[] => Array.isArray(schema.type) ? schema.type.map(String) : typeof schema.type === "string" ? [schema.type] : [];
const isNumeric = (types: string[]) => types.includes("number") || types.includes("integer");

/** Whether a case is a negative one. By its id too: a saved run keeps the id, not the kind. */
export function isNegativeScenario(scenario: { id: string; negative?: NegativeKind }) {
  return Boolean(scenario.negative) || scenario.id.startsWith("negative-");
}

/** The statuses a negative case of this operation accepts as a rejection, and the one it shows. */
export function negativeStatuses(endpoint: Endpoint, config: ProjectConfig) {
  const declared = endpoint.statuses.filter((status) => status >= 400 && status < 500 && !NOT_VALIDATION.has(status));
  const statuses = config.negativeCases?.statuses?.length ? config.negativeCases.statuses : declared.length ? declared : [400, 422];
  const shown = statuses.includes(422) ? 422 : statuses.includes(400) ? 400 : statuses[0];
  return { statuses, shown };
}

/** An object schema's members and required list, with `allOf` parts merged. */
function objectShape(schemaInput: unknown) {
  const schema = asRecord(schemaInput);
  const parts = [schema, ...(Array.isArray(schema.allOf) ? schema.allOf.map(asRecord) : [])];
  const properties: Json = {};
  const required = new Set<string>();
  let closed = false;
  for (const part of parts) {
    Object.assign(properties, asRecord(part.properties));
    if (Array.isArray(part.required)) part.required.forEach((name) => required.add(String(name)));
    if (part.additionalProperties === false) closed = true;
  }
  return { properties, required, closed };
}

const INVALID_FORMATS: Record<string, string> = { email: "not-an-email", uuid: "not-a-uuid", "date-time": "not-a-date-time", date: "2030-13-45", uri: "not a uri", url: "not a url", ipv4: "999.1.1.1" };

type Violation = { kind: NegativeKind; value: unknown };

/** Every single-fault value for one member or parameter, by kind. `asText` is a parameter's
 * view: everything travels as a string, so a wrong type is a string that does not parse. */
function violations(schemaInput: unknown, asText: boolean): Violation[] {
  const schema = asRecord(schemaInput);
  const types = typesOf(schema);
  const out: Violation[] = [];
  if (types.length) {
    if (asText) {
      if (types.includes("integer") && !types.includes("number") && !types.includes("string")) out.push({ kind: "type", value: "abc" });
      else if (types.includes("number") && !types.includes("string")) out.push({ kind: "type", value: "abc" });
      else if (types.includes("boolean") && !types.includes("string")) out.push({ kind: "type", value: "maybe" });
    } else {
      const wrong = !types.includes("string") ? "abc" : !isNumeric(types) ? 12345 : !types.includes("boolean") ? true : undefined;
      if (wrong !== undefined) out.push({ kind: "type", value: wrong });
      if (!types.includes("null") && schema.nullable !== true) out.push({ kind: "null", value: null });
    }
  }
  const text = (value: number) => asText ? String(value) : value;
  if (types.includes("string") || (!types.length && (schema.minLength !== undefined || schema.maxLength !== undefined))) {
    // An empty query value is not sent at all, so a parameter's lower bound cannot be tested.
    if (!asText && typeof schema.minLength === "number" && schema.minLength >= 1) out.push({ kind: "min-length", value: "x".repeat(schema.minLength - 1) });
    if (typeof schema.maxLength === "number" && schema.maxLength < MAX_GENERATED_LENGTH) out.push({ kind: "max-length", value: "x".repeat(schema.maxLength + 1) });
    const broken = typeof schema.format === "string" ? INVALID_FORMATS[schema.format] : undefined;
    if (broken) out.push({ kind: "format", value: broken });
  }
  if (isNumeric(types)) {
    // OpenAPI 3.1 states an exclusive bound as a number; 3.0 as a flag over `minimum`.
    const low = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : typeof schema.minimum === "number" ? (schema.exclusiveMinimum === true ? schema.minimum : schema.minimum - 1) : undefined;
    const high = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : typeof schema.maximum === "number" ? (schema.exclusiveMaximum === true ? schema.maximum : schema.maximum + 1) : undefined;
    if (low !== undefined) out.push({ kind: "minimum", value: text(low) });
    if (high !== undefined) out.push({ kind: "maximum", value: text(high) });
  }
  if (Array.isArray(schema.enum) && schema.enum.length) {
    if (schema.enum.every((item) => typeof item === "string")) {
      let value = "not-in-enum";
      while (schema.enum.includes(value)) value += "-x";
      out.push({ kind: "enum", value });
    } else if (schema.enum.every((item) => typeof item === "number")) {
      out.push({ kind: "enum", value: text(Math.max(...(schema.enum as number[])) + 1) });
    }
  }
  return out;
}

type Candidate = Omit<TestScenario, "name" | "description" | "expectedStatus" | "expectedStatuses" | "flow"> & { negative: NegativeKind; field?: string; where: "body" | "query" | "path" };

function describe(candidate: Candidate, locale: Locale) {
  const field = candidate.field ?? "";
  const at = candidate.where === "body" ? tr(locale, "el campo", "field") : candidate.where === "path" ? tr(locale, "el parámetro de ruta", "path parameter") : tr(locale, "el parámetro", "parameter");
  switch (candidate.negative) {
    case "malformed": return tr(locale, "Body que no es JSON", "Body that is not JSON");
    case "missing": return tr(locale, `Falta el campo requerido ${field}`, `Required field ${field} missing`);
    case "type": return tr(locale, `Tipo incorrecto en ${at} ${field}`, `Wrong type in ${at} ${field}`);
    case "null": return tr(locale, `${field} = null sin ser nullable`, `${field} = null, not nullable`);
    case "min-length": return tr(locale, `${field} más corto que su mínimo`, `${field} below its minimum length`);
    case "max-length": return tr(locale, `${field} más largo que su máximo`, `${field} over its maximum length`);
    case "minimum": return tr(locale, `${field} por debajo del mínimo`, `${field} below the minimum`);
    case "maximum": return tr(locale, `${field} por encima del máximo`, `${field} above the maximum`);
    case "enum": return tr(locale, `${field} fuera del enum`, `${field} not in the enum`);
    case "format": return tr(locale, `${field} con formato inválido`, `${field} with an invalid format`);
    case "extra": return tr(locale, "Campo no declarado (additionalProperties: false)", "Undeclared field (additionalProperties: false)");
  }
}

/**
 * The negative cases of one operation. None when the project turns them off, excludes the
 * operation, or the operation takes no input at all.
 */
export function negativeScenarios(endpoint: Endpoint, config: ProjectConfig, locale: Locale): TestScenario[] {
  const settings = config.negativeCases ?? {};
  if (settings.enabled === false || settings.exclude?.includes(endpoint.id)) return [];
  const schemas = config.requestSchemas?.[endpoint.id] ?? {};
  const cap = Math.max(0, Math.floor(settings.maxPerOperation ?? DEFAULT_NEGATIVE_CAP));
  const groups = new Map<NegativeKind, Candidate[]>(KIND_ORDER.map((kind) => [kind, []]));
  const push = (candidate: Candidate) => groups.get(candidate.negative)!.push(candidate);
  const takesBody = ["POST", "PUT", "PATCH"].includes(endpoint.method);
  const generated = schemas.body ? sampleFor(schemas.body) : undefined;
  const fixture = endpoint.method === "PUT" ? endpoint.replaceBody ?? endpoint.body : endpoint.body;
  const base = fixture ?? (generated && typeof generated === "object" && !Array.isArray(generated) ? generated as Json : undefined);
  const pathNames = pathParameters(endpoint.path);
  // Over an id that exists: over a missing one the API answers 404 before it looks at the body.
  const ids = Object.fromEntries(pathNames.filter((name) => endpoint.parameters?.includes(name)).map((name) => [name, existingId(config)]));

  if (takesBody && base) {
    // Cut short of its closing brace: valid up to the point where it stops being JSON.
    push({ id: "negative-body-malformed", negative: "malformed", where: "body", rawBody: JSON.stringify(base).slice(0, -1), parameters: ids });
    const { properties, required, closed } = objectShape(schemas.body);
    for (const [name, property] of Object.entries(properties)) {
      if (asRecord(property).readOnly) continue;
      if (required.has(name)) {
        const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== name));
        push({ id: `negative-body-missing-${name}`, negative: "missing", field: name, where: "body", body: rest, parameters: ids });
      }
      for (const { kind, value } of violations(property, false)) push({ id: `negative-body-${kind}-${name}`, negative: kind, field: name, where: "body", body: { ...base, [name]: value }, parameters: ids });
    }
    if (closed && !(EXTRA_MEMBER in properties)) push({ id: "negative-body-extra", negative: "extra", where: "body", body: { ...base, [EXTRA_MEMBER]: "x" }, parameters: ids });
  }
  for (const name of endpoint.parameters ?? []) {
    const schema = schemas.parameters?.[name];
    if (!schema) continue;
    const where = pathNames.includes(name) ? "path" : "query";
    for (const { kind, value } of violations(schema, true)) push({ id: `negative-${where}-${kind}-${name}`, negative: kind, field: name, where, parameters: { ...ids, [name]: String(value) }, ...(takesBody && base ? { body: base } : {}) });
  }

  const picked: Candidate[] = [];
  for (let round = 0; picked.length < cap; round += 1) {
    const layer = KIND_ORDER.map((kind) => groups.get(kind)![round]).filter(Boolean);
    if (!layer.length) break;
    picked.push(...layer.slice(0, cap - picked.length));
  }
  const { statuses, shown } = negativeStatuses(endpoint, config);
  const accepted = statuses.join("/");
  return picked.map((candidate) => ({
    id: candidate.id,
    negative: candidate.negative,
    ...(candidate.parameters && Object.keys(candidate.parameters).length ? { parameters: candidate.parameters } : {}),
    ...(candidate.body ? { body: candidate.body } : {}),
    ...(candidate.rawBody !== undefined ? { rawBody: candidate.rawBody } : {}),
    name: describe(candidate, locale),
    description: tr(locale, `Entrada inválida: debe rechazarse con ${accepted}. Un 2xx la acepta y un 5xx es un error del servidor; si una escritura la acepta, lo creado se borra.`, `Invalid input: it must be rejected with ${accepted}. A 2xx accepts it and a 5xx is a server error; if a write accepts it, whatever it created is deleted.`),
    expectedStatus: shown,
    expectedStatuses: statuses,
    flow: "negative",
  }));
}
