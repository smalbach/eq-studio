/**
 * Reading a Postman environment export (`*.postman_environment.json`) into the dashboard's
 * connection fields.
 *
 * Many APIs already keep one Postman environment per server (local, staging, production).
 * Importing it fills the base URL and the credentials instead of typing them by hand, where a
 * typo in the host fails every operation for a reason that has nothing to do with the API.
 *
 * It takes no React on purpose: the mapping is what can be wrong, and it can be tested without
 * a browser.
 */
import { tr } from "./i18n-core.mjs";

/**
 * The dashboard field each variable feeds, by normalized key.
 *
 * Normalization drops case and the `-`/`_`/space separators, so `access_token`, `accessToken`
 * and `ACCESS TOKEN` are the same variable. Postman itself imposes no naming, and the
 * environments someone else wrote are not going to match these keys letter by letter.
 */
const FIELD_BY_KEY = {
  baseurl: "baseUrl",
  base: "baseUrl",
  url: "baseUrl",
  host: "baseUrl",
  apiurl: "baseUrl",
  apibaseurl: "baseUrl",
  server: "baseUrl",
  serverurl: "baseUrl",
  accesstoken: "token",
  token: "token",
  bearer: "token",
  bearertoken: "token",
  jwt: "token",
  adminstoken: "token",
  apikey: "apiKey",
  xapikey: "apiKey",
  key: "apiKey",
  readtoken: "readToken",
  tokenread: "readToken",
  accesstokenread: "readToken",
  readaccesstoken: "readToken",
  readonlytoken: "readToken",
  insufficienttoken: "readToken",
};

export const ENVIRONMENT_FIELDS = ["baseUrl", "token", "apiKey", "readToken"];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[\s_-]/g, "");
}

/** A base URL is used as `${baseUrl}${path}`: a trailing slash would produce `//v1/products`. */
function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function readPostmanJson(source, locale = "es") {
  if (typeof source !== "string") return source;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(tr(locale, `El archivo no es JSON válido: ${error.message}`, `The file is not valid JSON: ${error.message}`));
  }
}

/**
 * Maps the enabled variables onto the dashboard fields.
 *
 * **An empty value never overwrites.** Versioned environments usually ship `client_secret`,
 * `access_token` and `api_key` empty and marked `type: secret`, because secrets are kept out of
 * the repository. Importing `local` to switch the host would otherwise wipe the token that was
 * just pasted in, and every 401 after it would look like the API's fault.
 */
export function mapEnvironmentValues(values) {
  const fields = {};
  const unmapped = [];
  for (const entry of values) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.enabled === false) continue;
    const key = String(entry.key ?? "").trim();
    if (!key) continue;
    const field = FIELD_BY_KEY[normalizeKey(key)];
    const value = typeof entry.value === "string" ? entry.value.trim() : entry.value == null ? "" : String(entry.value);
    if (!field) {
      unmapped.push(key);
      continue;
    }
    // First one wins: `baseUrl` and `url` in the same file are the same intent declared twice,
    // and the second is usually the leftover.
    if (!value || fields[field]) continue;
    fields[field] = field === "baseUrl" ? normalizeBaseUrl(value) : value;
  }
  return { fields, unmapped };
}

/**
 * Parses one Postman environment export.
 *
 * Throws with a message meant for the panel — the two mistakes worth naming are dropping a
 * collection in (often the file next to the environments, and the one a reader reaches for
 * first) and a file with no variables at all.
 */
export function parsePostmanEnvironment(source, fallbackName = "Entorno importado", locale = "es") {
  const document = readPostmanJson(source, locale);
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error(tr(locale, "El archivo no contiene un objeto JSON.", "The file does not contain a JSON object."));
  if (Array.isArray(document.item) || document.info) throw new Error(tr(locale, "Eso es una colección de Postman, no un entorno: impórtala como contrato desde «Importar» en Proyectos. Aquí va un archivo `*.postman_environment.json`.", "That is a Postman collection, not an environment: import it as a contract from \"Import\" in Projects. This takes a `*.postman_environment.json` file."));
  if (!Array.isArray(document.values)) throw new Error(tr(locale, "No parece un entorno de Postman: falta el arreglo `values`.", "Does not look like a Postman environment: the `values` array is missing."));
  const scope = document._postman_variable_scope;
  if (scope && scope !== "environment") throw new Error(tr(locale, `El archivo declara scope \`${scope}\`, y el dashboard solo aplica entornos.`, `The file declares scope \`${scope}\`, and the dashboard only applies environments.`));
  const { fields, unmapped } = mapEnvironmentValues(document.values);
  const variables = document.values.filter((entry) => entry && entry.enabled !== false).length;
  if (!variables) throw new Error(tr(locale, "El entorno no tiene variables habilitadas.", "The environment has no enabled variables."));
  return {
    id: typeof document.id === "string" && document.id ? document.id : `${fallbackName}-${variables}`,
    name: typeof document.name === "string" && document.name.trim() ? document.name.trim() : fallbackName,
    fields,
    unmapped,
    variables,
    /** What the panel reports: an environment that maps nothing is imported and says so. */
    mapped: ENVIRONMENT_FIELDS.filter((field) => fields[field]),
    /** Every enabled variable with a value, for resolving a collection's `{{baseUrl}}` on import. */
    variableValues: Object.fromEntries(document.values.filter((entry) => entry && entry.enabled !== false && typeof entry.key === "string" && entry.value != null && String(entry.value) !== "").map((entry) => [entry.key, String(entry.value)])),
  };
}

/**
 * Applies an environment over the current values, keeping whatever it does not carry.
 *
 * Returned as a plain object so the component sets state from one source instead of four, and so
 * the rule "an empty variable is not a value" is asserted once.
 */
export function applyEnvironment(current, environment) {
  const next = { ...current };
  for (const field of ENVIRONMENT_FIELDS) if (environment.fields[field]) next[field] = environment.fields[field];
  return next;
}
