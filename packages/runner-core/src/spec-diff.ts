/**
 * What changed between two versions of an OpenAPI 3 contract, and which changes break a client
 * written against the older one.
 *
 * The rule is the same everywhere: a change is breaking when a request that used to be valid is
 * no longer accepted, or when a response no longer gives a client what it used to rely on. So
 * the same edit reads in opposite directions depending on who sends the data — a new required
 * field breaks a request body and is harmless in a response; a removed field is harmless in a
 * request body and breaks a response.
 */
import { dereference } from "./contract.mjs";
import { tr } from "./i18n.mjs";
import type { Locale } from "./types.ts";

type Json = Record<string, unknown>;
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;
const MAX_DEPTH = 12;

export type SpecChangeKind =
  | "operation-added" | "operation-removed"
  | "parameter-added" | "parameter-removed" | "parameter-required" | "parameter-optional"
  | "request-body-added" | "request-body-removed" | "request-body-required"
  | "response-added" | "response-removed"
  | "field-added" | "field-removed" | "field-required" | "field-optional"
  | "type-changed" | "enum-value-added" | "enum-value-removed"
  | "security-added" | "security-removed" | "security-changed";

/**
 * One change. `location` says where in the operation (`query.limit`, `request`, `response 200`)
 * and `pointer` where in that schema (`$.items[].sku`); `before` and `after` carry the values
 * that changed (types, enum values, security requirements).
 */
export type SpecChange = {
  kind: SpecChangeKind;
  breaking: boolean;
  method: string;
  path: string;
  operationId?: string;
  location?: string;
  pointer?: string;
  required?: boolean;
  before?: unknown;
  after?: unknown;
};

export type SpecDiffSummary = { breaking: number; nonBreaking: number; operationsAdded: number; operationsRemoved: number; operationsChanged: number };
export type SpecDiff = { changes: SpecChange[]; summary: SpecDiffSummary };

const asRecord = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function openApi(input: unknown, label: string): Json {
  const spec = asRecord(input);
  if (typeof spec.openapi !== "string" || !spec.openapi.startsWith("3.")) throw new Error(`The ${label} document is not OpenAPI 3.`);
  return spec;
}

type Operation = { method: string; path: string; operationId?: string; node: Json; shared: unknown[] };

/** `/orders/{id}` and `/orders/{order_id}` are the same route: parameter names do not reach the wire. */
const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}")}`;

function operationsOf(spec: Json) {
  const found = new Map<string, Operation>();
  for (const [path, item] of Object.entries(asRecord(spec.paths))) {
    const pathItem = asRecord(dereference(item, spec));
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      const node = asRecord(pathItem[method]);
      found.set(routeKey(method, path), { method: method.toUpperCase(), path, operationId: typeof node.operationId === "string" ? node.operationId : undefined, node, shared: asArray(pathItem.parameters) });
    }
  }
  return found;
}

/** The operation's parameters by `in.name`, its own overriding the path's; header names ignore case. */
function parametersOf(operation: Operation, spec: Json) {
  const result = new Map<string, Json>();
  for (const parameter of [...operation.shared, ...asArray(operation.node.parameters)].map((item) => asRecord(dereference(item, spec)))) {
    if (typeof parameter.name !== "string" || typeof parameter.in !== "string") continue;
    result.set(`${parameter.in}.${parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name}`, parameter);
  }
  return result;
}

function jsonSchemaOf(content: unknown): unknown {
  const media = asRecord(content);
  const json = media["application/json"] ?? Object.entries(media).find(([type]) => type.includes("json"))?.[1] ?? Object.values(media)[0];
  return asRecord(json).schema;
}

/** One alternative per requirement, scopes included: `oauth[read,write]+apiKey`. Empty when anonymous access is allowed. */
function securityOf(operation: Operation, spec: Json): string[] | null {
  const requirements = asArray(Array.isArray(operation.node.security) ? operation.node.security : spec.security);
  if (!requirements.length || requirements.some((requirement) => Object.keys(asRecord(requirement)).length === 0)) return null;
  return requirements.map((requirement) => Object.entries(asRecord(requirement)).map(([name, scopes]) => `${name}${asArray(scopes).length ? `[${asArray(scopes).map(String).sort().join(",")}]` : ""}`).sort().join("+")).sort();
}

/** `allOf` merged into one schema, so a property moved into a shared component is not a change. */
function flatten(input: unknown): Json {
  const schema = asRecord(input);
  if (!Array.isArray(schema.allOf)) return schema;
  const parts = [...schema.allOf.map(flatten), { ...schema, allOf: undefined }];
  const merged: Json = {};
  const properties: Json = {};
  const required = new Set<string>();
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) if (value !== undefined && key !== "properties" && key !== "required" && !(key in merged)) merged[key] = value;
    Object.assign(properties, asRecord(part.properties));
    for (const name of asArray(part.required)) required.add(String(name));
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  delete merged.allOf;
  return merged;
}

function typesOf(schema: Json): string[] {
  const declared = Array.isArray(schema.type) ? schema.type.map(String) : typeof schema.type === "string" ? [schema.type] : schema.properties ? ["object"] : schema.items ? ["array"] : [];
  if (declared.length && schema.nullable === true && !declared.includes("null")) declared.push("null");
  return [...new Set(declared)].sort();
}

/** Whether every value of the `narrower` types is also one of the `wider` ones (an integer is a number). */
const accepts = (wider: string[], narrower: string[]) => narrower.every((type) => wider.includes(type) || (type === "integer" && wider.includes("number")));

type Direction = "request" | "response";
type Emit = (change: Omit<SpecChange, "method" | "path" | "operationId" | "location">) => void;

function compareSchemas(beforeInput: unknown, afterInput: unknown, direction: Direction, emit: Emit, pointer = "$", depth = 0) {
  if (depth > MAX_DEPTH) return;
  const before = flatten(beforeInput);
  const after = flatten(afterInput);
  const request = direction === "request";
  const [typesBefore, typesAfter] = [typesOf(before), typesOf(after)];
  if (typesBefore.length && typesAfter.length && typesBefore.join() !== typesAfter.join()) {
    // A request may widen what it takes; a response may narrow what it gives.
    emit({ kind: "type-changed", breaking: request ? !accepts(typesAfter, typesBefore) : !accepts(typesBefore, typesAfter), pointer, before: typesBefore.join(" | "), after: typesAfter.join(" | ") });
    return;
  }
  if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
    const [valuesBefore, valuesAfter] = [before.enum.map((value) => JSON.stringify(value)), after.enum.map((value) => JSON.stringify(value))];
    for (const value of valuesBefore.filter((item) => !valuesAfter.includes(item))) emit({ kind: "enum-value-removed", breaking: request, pointer, before: JSON.parse(value) });
    // A response with a value the old contract does not list fails a client that validates it.
    for (const value of valuesAfter.filter((item) => !valuesBefore.includes(item))) emit({ kind: "enum-value-added", breaking: !request, pointer, after: JSON.parse(value) });
  }
  // What only the other side sends is not part of this direction's contract.
  const visible = (property: unknown) => !asRecord(property)[request ? "readOnly" : "writeOnly"];
  const propertiesBefore = Object.fromEntries(Object.entries(asRecord(before.properties)).filter(([, property]) => visible(property)));
  const propertiesAfter = Object.fromEntries(Object.entries(asRecord(after.properties)).filter(([, property]) => visible(property)));
  const requiredBefore = new Set(asArray(before.required).map(String));
  const requiredAfter = new Set(asArray(after.required).map(String));
  const at = (name: string) => `${pointer}.${name}`;
  for (const name of Object.keys(propertiesAfter)) {
    if (name in propertiesBefore) continue;
    const required = requiredAfter.has(name);
    emit({ kind: "field-added", breaking: request && required, pointer: at(name), required });
  }
  for (const name of Object.keys(propertiesBefore)) {
    if (name in propertiesAfter) continue;
    emit({ kind: "field-removed", breaking: !request, pointer: at(name), required: requiredBefore.has(name) });
  }
  for (const name of Object.keys(propertiesBefore)) {
    if (!(name in propertiesAfter)) continue;
    if (!requiredBefore.has(name) && requiredAfter.has(name)) emit({ kind: "field-required", breaking: request, pointer: at(name) });
    if (requiredBefore.has(name) && !requiredAfter.has(name)) emit({ kind: "field-optional", breaking: !request, pointer: at(name) });
    compareSchemas(propertiesBefore[name], propertiesAfter[name], direction, emit, at(name), depth + 1);
  }
  if (before.items || after.items) compareSchemas(before.items, after.items, direction, emit, `${pointer}[]`, depth + 1);
  if (before.additionalProperties && after.additionalProperties && typeof before.additionalProperties === "object" && typeof after.additionalProperties === "object") compareSchemas(before.additionalProperties, after.additionalProperties, direction, emit, `${pointer}.*`, depth + 1);
  for (const key of ["oneOf", "anyOf"] as const) {
    const [partsBefore, partsAfter] = [asArray(before[key]), asArray(after[key])];
    for (let index = 0; index < Math.min(partsBefore.length, partsAfter.length); index += 1) compareSchemas(partsBefore[index], partsAfter[index], direction, emit, `${pointer}<${key}[${index}]>`, depth + 1);
  }
}

function compareOperations(before: Operation, after: Operation, specBefore: Json, specAfter: Json, push: (change: SpecChange) => void) {
  const base = { method: after.method, path: after.path, ...(after.operationId ? { operationId: after.operationId } : {}) };
  const emitAt = (location: string): Emit => (change) => push({ ...base, location, ...change });

  const parametersBefore = parametersOf(before, specBefore);
  const parametersAfter = parametersOf(after, specAfter);
  for (const [key, parameter] of parametersAfter) {
    const previous = parametersBefore.get(key);
    const required = parameter.required === true || parameter.in === "path";
    if (!previous) { push({ ...base, kind: "parameter-added", breaking: required, location: key, required }); continue; }
    const wasRequired = previous.required === true || previous.in === "path";
    if (!wasRequired && required) push({ ...base, kind: "parameter-required", breaking: true, location: key });
    if (wasRequired && !required) push({ ...base, kind: "parameter-optional", breaking: false, location: key });
    compareSchemas(dereference(previous.schema, specBefore), dereference(parameter.schema, specAfter), "request", emitAt(key));
  }
  for (const [key, parameter] of parametersBefore) if (!parametersAfter.has(key)) push({ ...base, kind: "parameter-removed", breaking: false, location: key, required: parameter.required === true });

  const bodyBefore = asRecord(dereference(before.node.requestBody, specBefore));
  const bodyAfter = asRecord(dereference(after.node.requestBody, specAfter));
  const hadBody = Boolean(before.node.requestBody);
  const hasBody = Boolean(after.node.requestBody);
  if (!hadBody && hasBody) push({ ...base, kind: "request-body-added", breaking: bodyAfter.required === true, location: "request", required: bodyAfter.required === true });
  if (hadBody && !hasBody) push({ ...base, kind: "request-body-removed", breaking: false, location: "request" });
  if (hadBody && hasBody) {
    if (bodyBefore.required !== true && bodyAfter.required === true) push({ ...base, kind: "request-body-required", breaking: true, location: "request" });
    compareSchemas(jsonSchemaOf(bodyBefore.content), jsonSchemaOf(bodyAfter.content), "request", emitAt("request"));
  }

  const responsesBefore = asRecord(dereference(before.node.responses, specBefore));
  const responsesAfter = asRecord(dereference(after.node.responses, specAfter));
  for (const status of Object.keys(responsesBefore)) {
    if (!(status in responsesAfter)) { push({ ...base, kind: "response-removed", breaking: true, location: `response ${status}` }); continue; }
    const [schemaBefore, schemaAfter] = [jsonSchemaOf(asRecord(responsesBefore[status]).content), jsonSchemaOf(asRecord(responsesAfter[status]).content)];
    if (schemaBefore && !schemaAfter) push({ ...base, kind: "field-removed", breaking: true, location: `response ${status}`, pointer: "$" });
    else compareSchemas(schemaBefore, schemaAfter, "response", emitAt(`response ${status}`));
  }
  for (const status of Object.keys(responsesAfter)) if (!(status in responsesBefore)) push({ ...base, kind: "response-added", breaking: false, location: `response ${status}` });

  const securityBefore = securityOf(before, specBefore);
  const securityAfter = securityOf(after, specAfter);
  if (!securityBefore && securityAfter) push({ ...base, kind: "security-added", breaking: true, location: "security", after: securityAfter });
  else if (securityBefore && !securityAfter) push({ ...base, kind: "security-removed", breaking: false, location: "security", before: securityBefore });
  else if (securityBefore && securityAfter && securityBefore.join() !== securityAfter.join()) {
    // A client keeps working as long as the way it authenticates is still one of the accepted ones.
    push({ ...base, kind: "security-changed", breaking: securityBefore.some((requirement) => !securityAfter.includes(requirement)), location: "security", before: securityBefore, after: securityAfter });
  }
}

/** The changes from `before` to `after`, both OpenAPI 3 documents; local `$ref`s are resolved. */
export function diffSpecs(beforeInput: unknown, afterInput: unknown): SpecDiff {
  const specBefore = openApi(beforeInput, "old");
  const specAfter = openApi(afterInput, "new");
  const operationsBefore = operationsOf(specBefore);
  const operationsAfter = operationsOf(specAfter);
  const changes: SpecChange[] = [];
  const changed = new Set<string>();
  let [added, removed] = [0, 0];
  for (const [key, operation] of operationsAfter) {
    const previous = operationsBefore.get(key);
    if (!previous) { added += 1; changes.push({ kind: "operation-added", breaking: false, method: operation.method, path: operation.path, ...(operation.operationId ? { operationId: operation.operationId } : {}) }); continue; }
    const count = changes.length;
    compareOperations(previous, operation, specBefore, specAfter, (change) => changes.push(change));
    if (changes.length > count) changed.add(key);
  }
  for (const [key, operation] of operationsBefore) {
    if (operationsAfter.has(key)) continue;
    removed += 1;
    changes.push({ kind: "operation-removed", breaking: true, method: operation.method, path: operation.path, ...(operation.operationId ? { operationId: operation.operationId } : {}) });
  }
  const breaking = changes.filter((change) => change.breaking).length;
  return { changes, summary: { breaking, nonBreaking: changes.length - breaking, operationsAdded: added, operationsRemoved: removed, operationsChanged: changed.size } };
}

/** The changes of each operation together, in the order they were found: `GET /orders` → its changes. */
export function changesByOperation(changes: SpecChange[]) {
  const groups = new Map<string, { method: string; path: string; operationId?: string; breaking: boolean; changes: SpecChange[] }>();
  for (const change of changes) {
    const key = `${change.method} ${change.path}`;
    const group = groups.get(key) ?? { method: change.method, path: change.path, operationId: change.operationId, breaking: false, changes: [] };
    group.changes.push(change);
    group.breaking ||= change.breaking;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const list = (value: unknown) => asArray(value).join(" | ") || "—";

/** One line for a change, without its operation: `query.limit: required parameter added`. */
export function describeChange(change: SpecChange, locale: Locale = "en") {
  const t = (es: string, en: string) => tr(locale, es, en);
  const field = change.pointer && change.pointer !== "$" ? change.pointer : "";
  const text = (() => {
    switch (change.kind) {
      case "operation-added": return t("operación nueva", "operation added");
      case "operation-removed": return t("operación eliminada", "operation removed");
      case "parameter-added": return change.required ? t("parámetro obligatorio nuevo", "required parameter added") : t("parámetro opcional nuevo", "optional parameter added");
      case "parameter-removed": return t("parámetro eliminado", "parameter removed");
      case "parameter-required": return t("el parámetro pasa a ser obligatorio", "parameter became required");
      case "parameter-optional": return t("el parámetro pasa a ser opcional", "parameter became optional");
      case "request-body-added": return change.required ? t("cuerpo obligatorio nuevo", "required request body added") : t("cuerpo opcional nuevo", "optional request body added");
      case "request-body-removed": return t("ya no tiene cuerpo", "request body removed");
      case "request-body-required": return t("el cuerpo pasa a ser obligatorio", "request body became required");
      case "response-added": return t("declarada", "declared");
      case "response-removed": return t("ya no se declara", "no longer declared");
      case "field-added": return change.required ? t(`campo obligatorio nuevo ${field}`, `required field ${field} added`) : t(`campo nuevo ${field}`, `field ${field} added`);
      case "field-removed": return field ? t(`campo eliminado ${field}`, `field ${field} removed`) : t("ya no declara esquema", "schema removed");
      case "field-required": return t(`${field} pasa a ser obligatorio`, `${field} became required`);
      case "field-optional": return t(`${field} pasa a ser opcional`, `${field} became optional`);
      case "type-changed": return t(`tipo ${change.before} → ${change.after}${field ? ` en ${field}` : ""}`, `type ${change.before} → ${change.after}${field ? ` at ${field}` : ""}`);
      case "enum-value-added": return t(`valor de enum nuevo ${JSON.stringify(change.after)}${field ? ` en ${field}` : ""}`, `enum value ${JSON.stringify(change.after)} added${field ? ` at ${field}` : ""}`);
      case "enum-value-removed": return t(`valor de enum eliminado ${JSON.stringify(change.before)}${field ? ` en ${field}` : ""}`, `enum value ${JSON.stringify(change.before)} removed${field ? ` at ${field}` : ""}`);
      case "security-added": return t(`ahora exige credencial (${list(change.after)})`, `now requires a credential (${list(change.after)})`);
      case "security-removed": return t("ya no exige credencial", "no longer requires a credential");
      case "security-changed": return t(`seguridad ${list(change.before)} → ${list(change.after)}`, `security ${list(change.before)} → ${list(change.after)}`);
    }
  })();
  return change.location ? `${change.location}: ${text}` : text;
}
