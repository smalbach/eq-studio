/**
 * JSON Schema validation against the API's live OpenAPI document.
 *
 * Plain `.mjs` on purpose: it runs unchanged in a browser, a Worker, a server and under
 * `node --test`. Whatever executes a case and whatever tests the executor share this one
 * implementation, so they cannot disagree about what conforms.
 */
import { tr } from "./i18n.mjs";

/**
 * Resolve `$ref` pointers into inline schemas.
 *
 * `seen` breaks recursive schemas: a self-referencing node resolves to `{}`, which validates
 * anything, rather than looping forever.
 *
 * @param {unknown} node
 * @param {Record<string, unknown>} root
 * @param {Set<string>} [seen]
 * @returns {unknown}
 */
const ANNOTATIONS = new Set(["description", "summary", "title", "example", "examples", "deprecated", "readOnly", "writeOnly", "$comment"]);

export function dereference(node, root, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen));
  if (!node || typeof node !== "object") return node;
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
    if (seen.has(record.$ref)) return {};
    let target = /** @type {unknown} */ (root);
    // JSON Pointer escapes: a reference into `paths` spells `/v1/orders` as `~1v1~1orders`.
    for (const part of record.$ref.slice(2).split("/")) target = /** @type {Record<string, unknown>} */ (target)?.[decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~")];
    const resolved = dereference(target, root, new Set(seen).add(record.$ref));
    // OpenAPI 3.1 allows keywords next to a `$ref`. Annotations just decorate the target; anything
    // else constrains it further, which is what `allOf` means.
    const siblings = Object.entries(record).filter(([key]) => key !== "$ref");
    if (!siblings.length) return resolved;
    const rest = Object.fromEntries(siblings.map(([key, value]) => [key, dereference(value, root, seen)]));
    return siblings.every(([key]) => ANNOTATIONS.has(key)) ? { ...(/** @type {object} */ (resolved)), ...rest } : { ...rest, allOf: [resolved] };
  }
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, dereference(value, root, seen)]));
}

/**
 * Validate a value against a dereferenced JSON Schema, collecting every failure.
 *
 * @param {unknown} value
 * @param {unknown} schema
 * @param {string} [path]
 * @param {string[]} [errors]
 * @param {"es" | "en"} [locale] the language of the messages
 * @returns {string[]} empty when the value conforms
 */
export function validateJson(value, schema, path = "$", errors = [], locale = "es") {
  /** @param {string} es @param {string} en */
  const t = (es, en) => tr(locale, es, en);
  // JSON Schema 2020-12 (OpenAPI 3.1) allows a boolean as a schema: `false` accepts nothing.
  if (schema === false) { errors.push(t(`${path}: no se permite ningún valor`, `${path}: no value is allowed`)); return errors; }
  if (!schema || typeof schema !== "object") return errors;
  const rule = /** @type {Record<string, unknown>} */ (schema);
  // OpenAPI 3.0 spells a nullable field `nullable: true`; 3.1 puts "null" in the type.
  if (value === null && rule.nullable === true) return errors;
  if (Array.isArray(rule.allOf)) rule.allOf.forEach((part) => validateJson(value, part, path, errors, locale));
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((part) => validateJson(value, part, path, [], locale).length === 0)) errors.push(t(`${path}: no coincide con ninguna alternativa`, `${path}: matches none of the alternatives`));
  if (Array.isArray(rule.oneOf) && rule.oneOf.filter((part) => validateJson(value, part, path, [], locale).length === 0).length !== 1) errors.push(t(`${path}: debe coincidir con una alternativa`, `${path}: must match exactly one alternative`));
  if (Array.isArray(rule.enum) && !rule.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) errors.push(t(`${path}: valor fuera del enum`, `${path}: value not in the enum`));
  if ("const" in rule && JSON.stringify(rule.const) !== JSON.stringify(value)) errors.push(t(`${path}: debe valer ${JSON.stringify(rule.const)}`, `${path}: must be ${JSON.stringify(rule.const)}`));
  if (rule.not !== undefined && validateJson(value, rule.not, path, [], locale).length === 0) errors.push(t(`${path}: coincide con un schema prohibido (not)`, `${path}: matches a forbidden schema (not)`));
  if (rule.if !== undefined) {
    const branch = validateJson(value, rule.if, path, [], locale).length === 0 ? rule.then : rule.else;
    if (branch !== undefined) validateJson(value, branch, path, errors, locale);
  }
  const types = Array.isArray(rule.type) ? rule.type : typeof rule.type === "string" ? [rule.type] : [];
  if (types.length) {
    const matches = types.some((type) => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" : typeof value === type);
    if (!matches) { errors.push(t(`${path}: tipo esperado ${types.join(" | ")}`, `${path}: expected type ${types.join(" | ")}`)); return errors; }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    const properties = /** @type {Record<string, unknown>} */ (rule.properties ?? {});
    for (const required of /** @type {string[]} */ (rule.required ?? [])) if (!(required in record)) errors.push(t(`${path}.${required}: campo requerido`, `${path}.${required}: required field`));
    const patterns = Object.entries(/** @type {Record<string, unknown>} */ (rule.patternProperties ?? {}));
    for (const [key, child] of Object.entries(record)) {
      const matching = patterns.filter(([pattern]) => new RegExp(pattern, "u").test(key));
      for (const [, patternSchema] of matching) validateJson(child, patternSchema, `${path}.${key}`, errors, locale);
      if (properties[key] !== undefined) validateJson(child, properties[key], `${path}.${key}`, errors, locale);
      else if (matching.length) continue;
      else if (rule.additionalProperties === false) errors.push(t(`${path}.${key}: campo adicional no permitido`, `${path}.${key}: additional field not allowed`));
      else if (rule.additionalProperties && typeof rule.additionalProperties === "object") validateJson(child, rule.additionalProperties, `${path}.${key}`, errors, locale);
    }
    const count = Object.keys(record).length;
    if (typeof rule.minProperties === "number" && count < rule.minProperties) errors.push(t(`${path}: menos de ${rule.minProperties} campos`, `${path}: fewer than ${rule.minProperties} fields`));
    if (typeof rule.maxProperties === "number" && count > rule.maxProperties) errors.push(t(`${path}: más de ${rule.maxProperties} campos`, `${path}: more than ${rule.maxProperties} fields`));
    for (const [key, needed] of Object.entries(/** @type {Record<string, string[]>} */ (rule.dependentRequired ?? {}))) if (key in record) for (const other of needed) if (!(other in record)) errors.push(t(`${path}.${other}: requerido cuando hay ${key}`, `${path}.${other}: required when ${key} is present`));
  }
  if (Array.isArray(value)) {
    // 2020-12 `prefixItems` types the first positions; `items` then covers the rest.
    const prefix = Array.isArray(rule.prefixItems) ? rule.prefixItems : [];
    prefix.forEach((part, index) => { if (index < value.length) validateJson(value[index], part, `${path}[${index}]`, errors, locale); });
    if (rule.items !== undefined && !Array.isArray(rule.items)) value.slice(prefix.length).forEach((item, index) => validateJson(item, rule.items, `${path}[${index + prefix.length}]`, errors, locale));
    if (typeof rule.minItems === "number" && value.length < rule.minItems) errors.push(t(`${path}: menos de ${rule.minItems} elementos`, `${path}: fewer than ${rule.minItems} items`));
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems) errors.push(t(`${path}: más de ${rule.maxItems} elementos`, `${path}: more than ${rule.maxItems} items`));
    if (rule.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(t(`${path}: elementos repetidos`, `${path}: repeated items`));
    if (rule.contains !== undefined && !value.some((item) => validateJson(item, rule.contains, path, [], locale).length === 0)) errors.push(t(`${path}: ningún elemento cumple contains`, `${path}: no item matches contains`));
  }
  if (typeof value === "number") {
    // 3.0 (draft 4) writes `exclusiveMinimum: true` next to `minimum`; 3.1 writes the bound itself.
    const lower = typeof rule.exclusiveMinimum === "number" ? rule.exclusiveMinimum : rule.exclusiveMinimum === true ? rule.minimum : undefined;
    const upper = typeof rule.exclusiveMaximum === "number" ? rule.exclusiveMaximum : rule.exclusiveMaximum === true ? rule.maximum : undefined;
    if (typeof rule.minimum === "number" && value < rule.minimum) errors.push(t(`${path}: menor que ${rule.minimum}`, `${path}: less than ${rule.minimum}`));
    if (typeof rule.maximum === "number" && value > rule.maximum) errors.push(t(`${path}: mayor que ${rule.maximum}`, `${path}: greater than ${rule.maximum}`));
    if (typeof lower === "number" && value <= lower) errors.push(t(`${path}: debe ser mayor que ${lower}`, `${path}: must be greater than ${lower}`));
    if (typeof upper === "number" && value >= upper) errors.push(t(`${path}: debe ser menor que ${upper}`, `${path}: must be less than ${upper}`));
    if (typeof rule.multipleOf === "number" && rule.multipleOf > 0 && Math.abs(value / rule.multipleOf - Math.round(value / rule.multipleOf)) > 1e-9) errors.push(t(`${path}: no es múltiplo de ${rule.multipleOf}`, `${path}: not a multiple of ${rule.multipleOf}`));
  }
  if (typeof value === "string") {
    if (typeof rule.minLength === "number" && value.length < rule.minLength) errors.push(t(`${path}: longitud menor que ${rule.minLength}`, `${path}: length less than ${rule.minLength}`));
    if (typeof rule.maxLength === "number" && value.length > rule.maxLength) errors.push(t(`${path}: longitud mayor que ${rule.maxLength}`, `${path}: length greater than ${rule.maxLength}`));
    if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) errors.push(t(`${path}: no cumple el patrón`, `${path}: does not match the pattern`));
  }
  return errors;
}

/**
 * The dereferenced response schema the document declares for one operation and status, or
 * `undefined` when it declares none.
 *
 * `undefined` is a legitimate answer and not a failure: APIs often answer a status they do not
 * declare (a 422 on a corrupt cursor, say). The caller checks the Problem Details shape in that
 * case instead of a schema.
 *
 * @param {Record<string, unknown>} spec
 * @param {string} operationPath the templated path, e.g. `/v1/orders/{order_id}/items`
 * @param {string} method
 * @param {number} status
 * @param {string} [contentType]
 * @returns {unknown | undefined}
 */
export function responseSchema(spec, operationPath, method, status, contentType = "application/json") {
  const paths = /** @type {Record<string, unknown>} */ (spec.paths ?? {});
  const operation = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (paths[operationPath])?.[method.toLowerCase()]);
  // A response is often a `$ref` to `components/responses` (one shared 404, one shared 401):
  // read without resolving it, it has no `content` and the status looks undeclared.
  const declared = /** @type {Record<string, unknown>} */ (dereference(/** @type {Record<string, unknown>} */ (operation?.responses)?.[String(status)], spec));
  const content = /** @type {Record<string, unknown>} */ (declared?.content ?? {});
  const media = /** @type {Record<string, unknown>} */ (content[contentType.split(";")[0]] ?? content["application/json"]);
  return media?.schema ? dereference(media.schema, spec) : undefined;
}
