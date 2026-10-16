/**
 * Which identifiers exist in an environment, so the "existing resource" cases ask for one.
 *
 * Cases are written against a seed where every resource has an id `1`. A shared environment is
 * not that seed: its ids start wherever its data starts, and some collections may be empty. A
 * "read an existing id" case over id `1` there is a correct 404 reported as a red case — a fact
 * about the data, not about the API. Before a run outside the seed, the first rows of each
 * collection are read (`IdSource` in `types.ts`) and the seed's ids 1..n are mapped onto them.
 *
 * What is empty stays empty and is reported by name: inventing an id would only move the 404.
 */

/** @typedef {import("./types.ts").IdSource} IdSource */

/** The value the cases use for "an id that exists" — the seed's. */
export const SEED_ID = "1";
export const DEFAULT_MAPPED_ROWS = 4;

/**
 * @param {IdSource[]} sources where each id comes from, in dependency order
 * @param {(path: string, operationPath: string) => Promise<{ status: number, body: unknown } | null>} getJson
 * @param {{ dataKey?: string, idFallbackKey?: string }} [envelope]
 * @returns {Promise<{ ids: Record<string, string>, lists: Record<string, string[]>, empty: string[], failed: string[] }>}
 */
export async function discoverIds(sources, getJson, { dataKey = "data", idFallbackKey = "id" } = {}) {
  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {Record<string, string[]>} */
  const lists = {};
  /** @type {string[]} */
  const empty = [];
  /** @type {string[]} */
  const failed = [];
  for (const source of sources) {
    if (source.needs && !ids[source.needs]) { empty.push(source.name); continue; }
    const path = source.needs ? source.path.replace(`{${source.needs}}`, ids[source.needs]) : source.path;
    const response = await getJson(path, source.operationPath).catch(() => null);
    if (!response || response.status !== 200) { failed.push(`${source.name} (${response?.status ?? "sin respuesta"})`); continue; }
    const payload = /** @type {Record<string, unknown> | unknown[] | undefined} */ (response.body);
    const rows = /** @type {Record<string, unknown>[]} */ ((dataKey ? /** @type {Record<string, unknown> | undefined} */ (payload)?.[dataKey] : payload) ?? []);
    // Nested rows may carry their key under a generic member (`id`) instead of the path's name.
    const values = (Array.isArray(rows) ? rows : []).map((row) => row?.[source.name] ?? row?.[idFallbackKey]).filter((value) => value !== undefined && value !== null).map(String);
    if (!values.length) empty.push(source.name);
    else { ids[source.name] = values[0]; lists[source.name] = values; }
  }
  return { ids, lists, empty, failed };
}

/**
 * The environment's row for the seed's id `n`, or `undefined` when it has fewer rows.
 * @param {Record<string, string[]>} lists @param {string} name @param {unknown} value @param {number} rows
 */
function mapped(lists, name, value, rows) {
  const index = Number(value) - 1;
  return Number.isInteger(index) && index >= 0 && index < rows ? lists[name]?.[index] : undefined;
}

/**
 * Replaces the seed ids 1..n of every id parameter with the environment's rows, in order. The
 * missing id of the not-found cases is far out of that range and stays missing.
 *
 * @param {Record<string, string>} values
 * @param {Record<string, string[]>} lists
 * @param {number} [rows]
 */
export function remapSeedIds(values, lists, rows = DEFAULT_MAPPED_ROWS) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, mapped(lists, name, value, rows) ?? value]));
}

/**
 * The same mapping over a write body: the numeric seed ids its `fields` hold, at any depth of
 * the `nested` members (a bulk's `records`).
 *
 * @param {unknown} body
 * @param {Record<string, string[]>} lists
 * @param {{ fields: string[], nested?: string[], rows?: number }} options
 * @returns {unknown}
 */
export function remapBodyIds(body, lists, { fields, nested = [], rows = DEFAULT_MAPPED_ROWS }) {
  if (Array.isArray(body)) return body.map((item) => remapBodyIds(item, lists, { fields, nested, rows }));
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(Object.entries(body).map(([key, value]) => {
    if (fields.includes(key) && typeof value === "number") {
      const target = mapped(lists, key, value, rows);
      return [key, target !== undefined && /^\d+$/.test(target) ? Number(target) : value];
    }
    return [key, nested.includes(key) ? remapBodyIds(value, lists, { fields, nested, rows }) : value];
  }));
}
