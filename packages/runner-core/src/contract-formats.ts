/**
 * Contracts that are not OpenAPI 3, turned into OpenAPI 3 before anything reads them.
 *
 * Everything downstream — the importer, the matrix, the schema validation of a run — speaks one
 * language, so a Swagger 2.0 document or a Postman collection is converted once, at the edge, and
 * the rest of the product never learns it existed. The conversion is deterministic: the same
 * input always gives the same document, so the content hash of the converted document still
 * identifies the original (importing the same Swagger file twice is the same version).
 *
 * Swagger 2.0 converts losslessly in what the product uses. A Postman collection does not declare
 * schemas, only examples: every schema it yields is inferred from one example and says so.
 */
type Json = Record<string, unknown>;

export type ContractFormat = "openapi" | "swagger" | "postman";
export type NormalizedContract = { document: Json; format: ContractFormat; warnings: string[]; baseUrl?: string };

const asRecord = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"];

/** What a document is, by the field each format is required to carry. */
export function contractFormatOf(input: unknown): ContractFormat | null {
  const document = asRecord(input);
  if (typeof document.openapi === "string" && document.openapi.startsWith("3.")) return "openapi";
  if (String(document.swagger ?? "").startsWith("2.")) return "swagger";
  const info = asRecord(document.info);
  if (Array.isArray(document.item) && (typeof info.schema === "string" ? /collection/i.test(info.schema) : typeof info.name === "string")) return "postman";
  return null;
}

/**
 * Any accepted contract as an OpenAPI 3 document. An OpenAPI 3 document is returned as it is;
 * anything else throws with the reason.
 */
export function toOpenApi3(input: unknown, options: { variables?: Record<string, string> } = {}): NormalizedContract {
  const format = contractFormatOf(input);
  if (format === "openapi") return { document: input as Json, format, warnings: [] };
  if (format === "swagger") return { document: swaggerToOpenApi(input), format, warnings: ["Converted from Swagger 2.0 to OpenAPI 3.0."] };
  if (format === "postman") {
    const converted = postmanToOpenApi(input, options.variables);
    return { document: converted.document, format, warnings: ["Generated from a Postman collection: the schemas are inferred from its examples, review them.", ...converted.warnings], ...(converted.baseUrl ? { baseUrl: converted.baseUrl } : {}) };
  }
  const document = asRecord(input);
  if (typeof document.swagger === "string") throw new Error(`Swagger ${document.swagger} is not supported: only Swagger 2.0 is converted.`);
  if (typeof document.openapi === "string") throw new Error(`OpenAPI ${document.openapi} is not supported: only OpenAPI 3.x.`);
  throw new Error("Not an OpenAPI 3, Swagger 2.0 or Postman collection document.");
}

// ─── Swagger 2.0 ──────────────────────────────────────────────────────────────────────────────

const REFS: [string, string][] = [["#/definitions/", "#/components/schemas/"], ["#/parameters/", "#/components/parameters/"], ["#/responses/", "#/components/responses/"]];

/** A Swagger 2.0 schema as an OpenAPI 3.0 schema: references moved, `x-nullable` and `file` mapped. */
function convertSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(convertSchema);
  if (!input || typeof input !== "object") return input;
  const out: Json = {};
  for (const [key, value] of Object.entries(input as Json)) {
    if (key === "$ref" && typeof value === "string") out.$ref = REFS.reduce((ref, [from, to]) => ref.startsWith(from) ? to + ref.slice(from.length) : ref, value);
    else if (key === "x-nullable") out.nullable = value;
    else if (key === "discriminator" && typeof value === "string") out.discriminator = { propertyName: value };
    else if (key === "type" && value === "file") { out.type = "string"; out.format = "binary"; }
    else if (key === "example" || key === "default" || key === "enum") out[key] = value;
    else out[key] = convertSchema(value);
  }
  return out;
}

const SCHEMA_KEYS = ["type", "format", "items", "enum", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "multipleOf"];

/** The schema a non-body Swagger parameter carries in its own fields. */
function parameterSchema(parameter: Json) {
  const schema: Json = {};
  for (const key of SCHEMA_KEYS) if (key in parameter) schema[key] = convertSchema(parameter[key]);
  if (schema.type === "file") { schema.type = "string"; schema.format = "binary"; }
  if (parameter["x-nullable"]) schema.nullable = true;
  return schema;
}

const COLLECTION_STYLES: Record<string, Json> = { csv: { style: "form", explode: false }, ssv: { style: "spaceDelimited", explode: false }, pipes: { style: "pipeDelimited", explode: false }, multi: { style: "form", explode: true } };

function convertParameter(parameter: Json): Json {
  if (typeof parameter.$ref === "string") return { $ref: String(asRecord(convertSchema(parameter)).$ref) };
  const out: Json = { name: parameter.name, in: parameter.in };
  for (const key of ["description", "required", "allowEmptyValue", "deprecated"]) if (key in parameter) out[key] = parameter[key];
  if (parameter.in === "path") out.required = true;
  out.schema = parameterSchema(parameter);
  if (typeof parameter.collectionFormat === "string" && COLLECTION_STYLES[parameter.collectionFormat] && parameter.in === "query") Object.assign(out, COLLECTION_STYLES[parameter.collectionFormat]);
  if ("x-example" in parameter) out.example = parameter["x-example"];
  for (const [key, value] of Object.entries(parameter)) if (key.startsWith("x-") && key !== "x-example" && key !== "x-nullable") out[key] = value;
  return out;
}

function convertResponse(response: Json, produces: string[]): Json {
  if (typeof response.$ref === "string") return { $ref: String(asRecord(convertSchema(response)).$ref) };
  const out: Json = { description: typeof response.description === "string" ? response.description : "" };
  const examples = asRecord(response.examples);
  if (response.schema) out.content = Object.fromEntries(produces.map((type) => [type, { schema: convertSchema(response.schema), ...(type in examples ? { example: examples[type] } : {}) }]));
  const headers = asRecord(response.headers);
  if (Object.keys(headers).length) out.headers = Object.fromEntries(Object.entries(headers).map(([name, header]) => [name, { ...(asRecord(header).description ? { description: asRecord(header).description } : {}), schema: parameterSchema(asRecord(header)) }]));
  for (const [key, value] of Object.entries(response)) if (key.startsWith("x-")) out[key] = value;
  return out;
}

/** A body parameter or a set of form fields as one request body. */
function requestBodyOf(body: Json | undefined, form: Json[], consumes: string[]): Json | undefined {
  if (body) {
    const types = consumes.filter((type) => !/form/.test(type));
    return { ...(body.description ? { description: body.description } : {}), content: Object.fromEntries((types.length ? types : ["application/json"]).map((type) => [type, { schema: convertSchema(body.schema ?? {}) }])), ...(body.required ? { required: true } : {}) };
  }
  if (!form.length) return undefined;
  const properties = Object.fromEntries(form.map((field) => [String(field.name), { ...parameterSchema(field), ...(field.description ? { description: field.description } : {}) }]));
  const required = form.filter((field) => field.required).map((field) => String(field.name));
  const schema = { type: "object", properties, ...(required.length ? { required } : {}) };
  const declared = consumes.filter((type) => /form/.test(type));
  const types = declared.length ? declared : [form.some((field) => field.type === "file") ? "multipart/form-data" : "application/x-www-form-urlencoded"];
  return { content: Object.fromEntries(types.map((type) => [type, { schema }])), ...(required.length ? { required: true } : {}) };
}

function convertSecurityScheme(scheme: Json): Json {
  const description = scheme.description ? { description: scheme.description } : {};
  if (scheme.type === "basic") return { type: "http", scheme: "basic", ...description };
  if (scheme.type === "apiKey") return { type: "apiKey", name: scheme.name, in: scheme.in, ...description };
  const scopes = asRecord(scheme.scopes);
  const flow = scheme.flow === "implicit" ? { implicit: { authorizationUrl: scheme.authorizationUrl, scopes } }
    : scheme.flow === "password" ? { password: { tokenUrl: scheme.tokenUrl, scopes } }
      : scheme.flow === "application" ? { clientCredentials: { tokenUrl: scheme.tokenUrl, scopes } }
        : { authorizationCode: { authorizationUrl: scheme.authorizationUrl, tokenUrl: scheme.tokenUrl, scopes } };
  return { type: "oauth2", flows: flow, ...description };
}

/** Swagger 2.0 to OpenAPI 3.0.3, covering what the product reads and keeping the rest as it is. */
export function swaggerToOpenApi(input: unknown): Json {
  const swagger = asRecord(input);
  const globalConsumes = asArray(swagger.consumes).map(String);
  const globalProduces = asArray(swagger.produces).map(String);
  const sharedParameters = asRecord(swagger.parameters);
  /** A `#/parameters/x` reference to a body or form parameter cannot stay a parameter in 3.0. */
  const resolve = (parameter: Json): Json => {
    const ref = typeof parameter.$ref === "string" && parameter.$ref.startsWith("#/parameters/") ? parameter.$ref.slice("#/parameters/".length) : null;
    const target = ref ? asRecord(sharedParameters[ref]) : null;
    return target && (target.in === "body" || target.in === "formData") ? target : parameter;
  };
  const host = typeof swagger.host === "string" ? swagger.host : "";
  const basePath = typeof swagger.basePath === "string" ? swagger.basePath.replace(/\/+$/, "") : "";
  const schemes = asArray(swagger.schemes).map(String).filter((scheme) => scheme === "http" || scheme === "https");
  // With no scheme Swagger means "the one the document was read with"; a local host is http.
  const servers = host ? (schemes.length ? schemes : [/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? "http" : "https"]).map((scheme) => ({ url: `${scheme}://${host}${basePath}` })) : basePath ? [{ url: basePath }] : [];

  const paths: Json = {};
  for (const [path, itemInput] of Object.entries(asRecord(swagger.paths))) {
    const item = asRecord(itemInput);
    if (typeof item.$ref === "string") { paths[path] = { $ref: item.$ref }; continue; }
    const shared = asArray(item.parameters).map(asRecord).map(resolve);
    const out: Json = {};
    for (const [key, value] of Object.entries(item)) if (key.startsWith("x-") || key === "summary" || key === "description") out[key] = value;
    const sharedPlain = shared.filter((parameter) => parameter.in !== "body" && parameter.in !== "formData");
    if (sharedPlain.length) out.parameters = sharedPlain.map(convertParameter);
    for (const method of METHODS) {
      if (!item[method]) continue;
      const operation = asRecord(item[method]);
      const consumes = asArray(operation.consumes).length ? asArray(operation.consumes).map(String) : globalConsumes;
      const produces = asArray(operation.produces).length ? asArray(operation.produces).map(String) : globalProduces.length ? globalProduces : ["application/json"];
      const own = asArray(operation.parameters).map(asRecord).map(resolve);
      const all = [...shared.filter((parameter) => !own.some((mine) => mine.name === parameter.name && mine.in === parameter.in)), ...own];
      const converted: Json = {};
      for (const [key, value] of Object.entries(operation)) {
        if (["parameters", "responses", "consumes", "produces", "schemes"].includes(key)) continue;
        converted[key] = value;
      }
      const plain = own.filter((parameter) => parameter.in !== "body" && parameter.in !== "formData");
      if (plain.length) converted.parameters = plain.map(convertParameter);
      const body = requestBodyOf(all.find((parameter) => parameter.in === "body"), all.filter((parameter) => parameter.in === "formData"), consumes);
      if (body) converted.requestBody = body;
      converted.responses = Object.fromEntries(Object.entries(asRecord(operation.responses)).map(([status, response]) => [status, convertResponse(asRecord(response), produces)]));
      out[method] = converted;
    }
    paths[path] = out;
  }

  const components: Json = {};
  if (swagger.definitions) components.schemas = convertSchema(swagger.definitions);
  const plainShared = Object.entries(sharedParameters).filter(([, parameter]) => !["body", "formData"].includes(String(asRecord(parameter).in)));
  if (plainShared.length) components.parameters = Object.fromEntries(plainShared.map(([name, parameter]) => [name, convertParameter(asRecord(parameter))]));
  if (swagger.responses) components.responses = Object.fromEntries(Object.entries(asRecord(swagger.responses)).map(([name, response]) => [name, convertResponse(asRecord(response), globalProduces.length ? globalProduces : ["application/json"])]));
  if (swagger.securityDefinitions) components.securitySchemes = Object.fromEntries(Object.entries(asRecord(swagger.securityDefinitions)).map(([name, scheme]) => [name, convertSecurityScheme(asRecord(scheme))]));

  const document: Json = { openapi: "3.0.3", info: swagger.info ?? { title: "API", version: "1.0.0" } };
  if (servers.length) document.servers = servers;
  for (const key of ["tags", "externalDocs", "security"]) if (swagger[key] !== undefined) document[key] = swagger[key];
  document.paths = paths;
  if (Object.keys(components).length) document.components = components;
  for (const [key, value] of Object.entries(swagger)) if (key.startsWith("x-")) document[key] = value;
  return document;
}

// ─── Postman collection v2.x ──────────────────────────────────────────────────────────────────

/** A schema that one example satisfies: types and shape, never `required` — one example cannot say what is optional. */
export function inferSchema(value: unknown, depth = 0): Json {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) return { type: "array", ...(value.length && depth < 8 ? { items: inferSchema(value[0], depth + 1) } : {}) };
  if (typeof value === "object") return depth < 8 ? { type: "object", properties: Object.fromEntries(Object.entries(value as Json).map(([key, child]) => [key, inferSchema(child, depth + 1)])) } : { type: "object" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return { type: "string", format: "date-time" };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return { type: "string", format: "uuid" };
  return { type: "string" };
}

const VARIABLE = /\{\{\s*([^}]+?)\s*\}\}/g;
const HEADERS_NOT_PARAMETERS = new Set(["content-type", "accept", "authorization", "content-length", "user-agent", "host", "cookie"]);

/** `List orders` → `listOrders`. */
function camel(name: string) {
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join("");
}

function variablesOf(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of asArray(list).map(asRecord)) if (typeof entry.key === "string" && entry.disabled !== true && entry.enabled !== false && entry.value != null && String(entry.value) !== "") out[entry.key] = String(entry.value);
  return out;
}

/** The variables of a Postman environment export, for resolving a collection's `{{baseUrl}}`. */
export function postmanEnvironmentVariables(environment: unknown) {
  return variablesOf(asRecord(environment).values);
}

const substitute = (text: string, variables: Record<string, string>) => text.replace(VARIABLE, (whole, name: string) => variables[name] ?? whole);

/** A query value as a typed example: `10` is an integer, `{{limit}}` whatever it resolves to. */
function scalarExample(raw: string) {
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d*\.\d+$/.test(raw)) return Number(raw);
  if (raw === "true" || raw === "false") return raw === "true";
  return raw;
}

type PostmanUrl = { base: string | null; segments: string[]; query: Json[] };

/**
 * The parts of a request URL: what goes before the path (a `{{baseUrl}}` or a literal origin),
 * the path segments and the query.
 */
function readUrl(input: unknown): PostmanUrl {
  if (typeof input === "string" || (asRecord(input).raw && !asRecord(input).path)) {
    const raw = typeof input === "string" ? input : String(asRecord(input).raw);
    const [beforeQuery, queryString = ""] = raw.split("?");
    const query = queryString.split("&").filter(Boolean).map((pair) => { const [key, value = ""] = pair.split("="); return { key: decodeURIComponent(key), value: decodeURIComponent(value) }; });
    const variableBase = /^\{\{[^}]+\}\}/.exec(beforeQuery);
    const literal = /^(https?:\/\/[^/]+)/.exec(beforeQuery);
    const base = variableBase?.[0] ?? literal?.[1] ?? null;
    const rest = base ? beforeQuery.slice(base.length) : beforeQuery.replace(/^[^/]*/, "");
    return { base, segments: rest.split("/").filter(Boolean), query };
  }
  const url = asRecord(input);
  const host = asArray(url.host).map(String).join(".");
  const protocol = typeof url.protocol === "string" ? `${url.protocol}://` : "";
  const port = url.port ? `:${String(url.port)}` : "";
  const base = host ? (/^\{\{[^}]+\}\}$/.test(host) ? host : `${protocol || "https://"}${host}${port}`) : null;
  const path = Array.isArray(url.path) ? url.path.map((segment) => typeof segment === "string" ? segment : String(asRecord(segment).value ?? "")) : String(url.path ?? "").split("/");
  return { base, segments: path.filter(Boolean), query: asArray(url.query).map(asRecord) };
}

type Collected = { name: string; request: Json; responses: Json[]; tag: string | undefined; auth: Json | undefined };

/** Every request of the collection, in order, with the folder it sits in as its tag. */
function collect(items: unknown, tag: string | undefined, auth: Json | undefined, out: Collected[]) {
  for (const item of asArray(items).map(asRecord)) {
    const inherited = item.auth ? asRecord(item.auth) : auth;
    if (Array.isArray(item.item)) collect(item.item, typeof item.name === "string" ? item.name : tag, inherited, out);
    else if (item.request) {
      const request = typeof item.request === "string" ? { method: "GET", url: item.request } : asRecord(item.request);
      out.push({ name: String(item.name ?? ""), request, responses: asArray(item.response).map(asRecord), tag, auth: request.auth ? asRecord(request.auth) : inherited });
    }
  }
}

/** The security scheme a Postman auth block stands for, or `null` for "no auth". */
function schemeOf(auth: Json | undefined): [string, Json] | null | undefined {
  if (!auth) return undefined;
  const settings = Object.fromEntries(asArray(auth[String(auth.type)]).map(asRecord).map((entry) => [String(entry.key), entry.value]));
  if (auth.type === "noauth") return null;
  if (auth.type === "bearer" || auth.type === "oauth2" || auth.type === "jwt") return ["bearerAuth", { type: "http", scheme: "bearer" }];
  if (auth.type === "basic") return ["basicAuth", { type: "http", scheme: "basic" }];
  if (auth.type === "apikey") { const name = String(settings.key ?? "X-API-Key"); const where = settings.in === "query" ? "query" : "header"; return [`apiKey_${camel(name)}`, { type: "apiKey", name, in: where }]; }
  return undefined;
}

/** A raw JSON body that may hold `{{variables}}`, parsed with each one replaced by its value or a placeholder. */
function parseBody(raw: string, variables: Record<string, string>): { ok: true; value: unknown } | { ok: false } {
  // Inside a string a variable is text; outside one it stands for a whole value.
  const bare = raw.split(/("(?:[^"\\]|\\.)*")/).map((part, index) => index % 2 ? part.replace(VARIABLE, (whole, name: string) => variables[name] !== undefined ? JSON.stringify(variables[name]).slice(1, -1) : whole) : part.replace(VARIABLE, (_whole, name: string) => { const value = variables[name]; return value !== undefined && /^(-?\d+(\.\d+)?|true|false|null)$/.test(value) ? value : JSON.stringify(value ?? `{{${name}}}`); })).join("");
  try { return { ok: true, value: JSON.parse(bare) }; } catch { return { ok: false }; }
}

function jsonOf(text: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof text !== "string" || !text.trim()) return { ok: false };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

/**
 * A Postman collection (v2.0 or v2.1) as an OpenAPI 3.0.3 document: one operation per request,
 * `{{var}}` and `:var` path segments as path parameters, folders as tags, saved responses as the
 * operation's statuses, and every schema inferred from the bodies the collection carries.
 * `baseUrl` is the value the leading `{{variable}}` of the URLs resolves to, when it resolves.
 */
export function postmanToOpenApi(input: unknown, extraVariables: Record<string, string> = {}): { document: Json; warnings: string[]; baseUrl?: string } {
  const collection = asRecord(input);
  const info = asRecord(collection.info);
  const variables = { ...variablesOf(collection.variable), ...extraVariables };
  const warnings: string[] = [];
  const requests: Collected[] = [];
  collect(collection.item, undefined, collection.auth ? asRecord(collection.auth) : undefined, requests);
  const paths: Record<string, Json> = {};
  const schemes: Json = {};
  const bases = new Map<string, number>();
  const ids = new Set<string>();
  const collectionScheme = schemeOf(collection.auth ? asRecord(collection.auth) : undefined);
  if (collectionScheme) schemes[collectionScheme[0]] = collectionScheme[1];

  for (const { name, request, responses, tag, auth } of requests) {
    const method = String(request.method ?? "GET").toLowerCase();
    if (!METHODS.includes(method)) { warnings.push(`${name}: method ${String(request.method)} skipped.`); continue; }
    const url = readUrl(request.url);
    if (url.base) bases.set(url.base, (bases.get(url.base) ?? 0) + 1);
    const pathParameters: Json[] = [];
    const describedVariables = Object.fromEntries(asArray(asRecord(request.url).variable).map(asRecord).map((entry) => [String(entry.key), entry]));
    const segments = url.segments.map((segment) => {
      const named = /^:(.+)$/.exec(segment)?.[1] ?? /^\{\{\s*([^}]+?)\s*\}\}$/.exec(segment)?.[1];
      if (!named) return segment;
      const parameterName = named.replace(/[^A-Za-z0-9_.-]/g, "_");
      if (!pathParameters.some((parameter) => parameter.name === parameterName)) {
        const described = asRecord(describedVariables[named]);
        const value = typeof described.value === "string" && described.value && !described.value.includes("{{") ? described.value : variables[named];
        pathParameters.push({ name: parameterName, in: "path", required: true, schema: value !== undefined ? inferSchema(scalarExample(value)) : { type: "string" }, ...(value !== undefined ? { example: scalarExample(value) } : {}), ...(described.description ? { description: String(asRecord(described).description) } : {}) });
      }
      return `{${parameterName}}`;
    });
    const path = `/${segments.join("/")}`;
    const pathItem = paths[path] ??= {};
    if (pathItem[method]) { warnings.push(`${name}: ${method.toUpperCase()} ${path} is already declared by another request, skipped.`); continue; }

    const query = url.query.filter((entry) => entry.disabled !== true && typeof entry.key === "string" && entry.key).map((entry) => {
      const raw = substitute(String(entry.value ?? ""), variables);
      const known = raw && !raw.includes("{{");
      return { name: String(entry.key), in: "query", required: false, schema: known ? inferSchema(scalarExample(raw)) : { type: "string" }, ...(known ? { example: scalarExample(raw) } : {}), ...(entry.description ? { description: String(entry.description) } : {}) };
    });
    const headers = asArray(request.header).map(asRecord).filter((entry) => entry.disabled !== true && typeof entry.key === "string" && !HEADERS_NOT_PARAMETERS.has(entry.key.toLowerCase())).map((entry) => {
      const raw = substitute(String(entry.value ?? ""), variables);
      return { name: String(entry.key), in: "header", required: false, schema: { type: "string" }, ...(raw && !raw.includes("{{") ? { example: raw } : {}) };
    });
    const parameters = [...pathParameters, ...query.filter((entry, index) => query.findIndex((other) => other.name === entry.name) === index), ...headers];

    let operationId = camel(name) || "";
    if (!operationId || ids.has(operationId) || !/^[a-z]/.test(operationId)) operationId = `${method}${segments.map((segment) => segment.replace(/[{}]/g, "")).join("-").split(/[^A-Za-z0-9]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join("")}`;
    for (let index = 2; ids.has(operationId); index += 1) operationId = `${operationId.replace(/\d+$/, "")}${index}`;
    ids.add(operationId);

    const operation: Json = { operationId, summary: name || `${method.toUpperCase()} ${path}`, ...(tag ? { tags: [tag] } : {}) };
    const description = typeof request.description === "string" ? request.description : typeof asRecord(request.description).content === "string" ? String(asRecord(request.description).content) : "";
    if (description) operation.description = description;
    if (parameters.length) operation.parameters = parameters;

    const body = asRecord(request.body);
    if (body.disabled !== true && ["post", "put", "patch", "delete"].includes(method)) {
      if (body.mode === "raw" && typeof body.raw === "string" && body.raw.trim()) {
        const language = String(asRecord(asRecord(body.options).raw).language ?? "");
        const parsed = parseBody(body.raw, variables);
        if (parsed.ok) operation.requestBody = { content: { "application/json": { schema: inferSchema(parsed.value), example: parsed.value } } };
        else if (!language || language === "json") warnings.push(`${name}: the body is not valid JSON, left out.`);
        else operation.requestBody = { content: { [language === "xml" ? "application/xml" : "text/plain"]: { schema: { type: "string" }, example: body.raw } } };
      } else if (body.mode === "urlencoded" || body.mode === "formdata") {
        const fields = asArray(body[body.mode]).map(asRecord).filter((field) => field.disabled !== true && typeof field.key === "string");
        const properties = Object.fromEntries(fields.map((field) => [String(field.key), field.type === "file" ? { type: "string", format: "binary" } : { type: "string", ...(field.value ? { example: substitute(String(field.value), variables) } : {}) }]));
        operation.requestBody = { content: { [body.mode === "formdata" ? "multipart/form-data" : "application/x-www-form-urlencoded"]: { schema: { type: "object", properties } } } };
      } else if (body.mode === "graphql") {
        operation.requestBody = { content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" }, variables: { type: "object" } } } } } };
      }
    }

    const declared: Json = {};
    for (const response of responses) {
      const code = Number(response.code);
      if (!Number.isInteger(code) || code < 100 || code > 599 || declared[String(code)]) continue;
      const parsed = jsonOf(response.body);
      const contentType = asArray(response.header).map(asRecord).find((header) => String(header.key).toLowerCase() === "content-type")?.value;
      declared[String(code)] = { description: String(response.name || response.status || code), ...(parsed.ok ? { content: { [typeof contentType === "string" && contentType.includes("json") ? contentType.split(";")[0].trim() : "application/json"]: { schema: inferSchema(parsed.value), example: parsed.value } } } : {}) };
    }
    operation.responses = Object.keys(declared).length ? declared : { [method === "post" ? "201" : method === "delete" ? "204" : "200"]: { description: "Not stated in the collection: no saved response." } };

    const scheme = schemeOf(auth);
    if (scheme === null) operation.security = [];
    else if (scheme && scheme[0] !== collectionScheme?.[0]) { schemes[scheme[0]] = scheme[1]; operation.security = [{ [scheme[0]]: [] }]; }
    pathItem[method] = operation;
  }

  const base = [...bases.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  let baseUrl: string | undefined;
  if (base) {
    const resolved = substitute(base, variables).replace(/\/+$/, "");
    if (/^https?:\/\//.test(resolved)) baseUrl = resolved;
    else warnings.push(`${base} has no value in the collection: set the environment's base URL by hand.`);
  }
  const versionVariable = variables.version ?? variables.apiVersion;
  const document: Json = {
    openapi: "3.0.3",
    info: { title: String(info.name ?? "API"), version: typeof info.version === "string" ? info.version : versionVariable ?? "1.0.0", ...(typeof info.description === "string" && info.description ? { description: info.description } : {}) },
    ...(baseUrl ? { servers: [{ url: baseUrl }] } : {}),
    paths,
    ...(Object.keys(schemes).length ? { components: { securitySchemes: schemes } } : {}),
    ...(collectionScheme ? { security: [{ [collectionScheme[0]]: [] }] } : {}),
    "x-eq-source": "postman-collection",
  };
  if (!requests.length) warnings.push("The collection has no requests.");
  return { document, warnings, ...(baseUrl ? { baseUrl } : {}) };
}
