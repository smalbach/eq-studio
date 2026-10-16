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
export function dereference(node, root, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen));
  if (!node || typeof node !== "object") return node;
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/")) {
    if (seen.has(record.$ref)) return {};
    let target = /** @type {unknown} */ (root);
    for (const part of record.$ref.slice(2).split("/")) target = /** @type {Record<string, unknown>} */ (target)?.[part];
    return dereference(target, root, new Set(seen).add(record.$ref));
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
  if (!schema || typeof schema !== "object") return errors;
  const rule = /** @type {Record<string, unknown>} */ (schema);
  if (Array.isArray(rule.allOf)) rule.allOf.forEach((part) => validateJson(value, part, path, errors, locale));
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((part) => validateJson(value, part, path, [], locale).length === 0)) errors.push(t(`${path}: no coincide con ninguna alternativa`, `${path}: matches none of the alternatives`));
  if (Array.isArray(rule.oneOf) && rule.oneOf.filter((part) => validateJson(value, part, path, [], locale).length === 0).length !== 1) errors.push(t(`${path}: debe coincidir con una alternativa`, `${path}: must match exactly one alternative`));
  if (Array.isArray(rule.enum) && !rule.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) errors.push(t(`${path}: valor fuera del enum`, `${path}: value not in the enum`));
  const types = Array.isArray(rule.type) ? rule.type : typeof rule.type === "string" ? [rule.type] : [];
  if (types.length) {
    const matches = types.some((type) => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" : typeof value === type);
    if (!matches) { errors.push(t(`${path}: tipo esperado ${types.join(" | ")}`, `${path}: expected type ${types.join(" | ")}`)); return errors; }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    const properties = /** @type {Record<string, unknown>} */ (rule.properties ?? {});
    for (const required of /** @type {string[]} */ (rule.required ?? [])) if (!(required in record)) errors.push(t(`${path}.${required}: campo requerido`, `${path}.${required}: required field`));
    for (const [key, child] of Object.entries(record)) {
      if (properties[key]) validateJson(child, properties[key], `${path}.${key}`, errors, locale);
      else if (rule.additionalProperties === false) errors.push(t(`${path}.${key}: campo adicional no permitido`, `${path}.${key}: additional field not allowed`));
    }
  }
  if (Array.isArray(value) && rule.items) value.forEach((item, index) => validateJson(item, rule.items, `${path}[${index}]`, errors, locale));
  if (typeof value === "number") {
    if (typeof rule.minimum === "number" && value < rule.minimum) errors.push(t(`${path}: menor que ${rule.minimum}`, `${path}: less than ${rule.minimum}`));
    if (typeof rule.maximum === "number" && value > rule.maximum) errors.push(t(`${path}: mayor que ${rule.maximum}`, `${path}: greater than ${rule.maximum}`));
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
