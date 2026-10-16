/**
 * The mock store: a small, fictional API that behaves the way a well-built one should, so the
 * whole Endpoint Quality matrix can run against it with no network and no database.
 *
 * It is deliberately strict where real APIs tend to be lax — 404 before validation on a missing
 * id, 409 on a natural key, 422 on a corrupt cursor, an empty PATCH or any body or parameter the
 * contract rejects (a wrong type, a null, a bound, an enum, a format, an undeclared member, a
 * body that is not JSON), Problem Details on every error, 405 on a known path with the wrong
 * method — because those are the cases the engine exists to check. Every answer matches `openapi.mjs`, which the engine validates against.
 *
 * Zero dependencies and in-memory state reset to a deterministic seed: ids 1..4 in every
 * top-level collection, so the engine's "existing" id `1` is always there and `999999` never is.
 *
 * `server.mjs` runs it from the command line; this module only builds it, so it can be bundled.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { openApiDocument } from "./openapi.mjs";

const PROBLEM_BASE = "https://mock-store.example/problems";
const DEFAULT_LIMIT = 20;
const DEFAULT_RADIUS_KM = 5;
const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => a.price - b.price || a.product_id - b.product_id,
  "-price": (a, b) => b.price - a.price || a.product_id - b.product_id,
};

// The seeded stores sit around one fictional town centre: two within 1 km, the other two within
// 20 km, none near (0, 0). That spread is what lets a geographic case tell a real radius filter
// from one that is ignored — with every store at the same point, any radius returns everything.
export const TOWN_CENTRE = { lat: 40, lon: -100 };

function seedState() {
  const products = [
    { product_id: 1, sku: "SKU-0001", name: "Desk Lamp", description: "Adjustable arm, warm light.", category: "lighting", price: 24.9, stock: 40 },
    { product_id: 2, sku: "SKU-0002", name: "Floor Lamp", description: null, category: "lighting", price: 59, stock: 12 },
    { product_id: 3, sku: "SKU-0003", name: "Oak Bookshelf", description: "Five shelves.", category: "furniture", price: 129, stock: 5 },
    { product_id: 4, sku: "SKU-0004", name: "Ceramic Mug", description: "350 ml.", category: "kitchen", price: 8.5, stock: 200 },
  ];
  const stores = [
    { store_id: 1, name: "Market Square", address: "1 Market Square", lat: 40.002, lon: -100, phone: "+1 555 0101", email: "market@mock-store.example" },
    { store_id: 2, name: "Station Road", address: "8 Station Road", lat: 40, lon: -100.006, phone: null, email: null },
    { store_id: 3, name: "Riverside", address: "220 River Lane", lat: 40.07, lon: -100, phone: "+1 555 0103", email: "riverside@mock-store.example" },
    { store_id: 4, name: "Hillside", address: "3 Hill Road", lat: 39.88, lon: -100, phone: null, email: null },
  ];
  const reviews = [
    { id: 1, product_id: 1, store_id: 1, rating: 5, author: "Robin", comment: "Bright enough to read by." },
    { id: 2, product_id: 1, store_id: null, rating: 4, author: "Kim", comment: "" },
    { id: 3, product_id: 1, store_id: 2, rating: 3, author: "Lee", comment: "The arm is a bit stiff." },
    { id: 4, product_id: 2, store_id: null, rating: 5, author: "Jo", comment: "Good value." },
  ];
  return {
    products: new Map(products.map((row) => [row.product_id, row])),
    stores: new Map(stores.map((row) => [row.store_id, row])),
    reviews: new Map(reviews.map((row) => [row.id, row])),
    next: { product: 5, store: 5, review: 5 },
  };
}

class HttpError extends Error {
  /** @param {number} status @param {string} title @param {string} detail @param {Record<string, string>} [headers] */
  constructor(status, title, detail, headers = {}) {
    super(detail);
    this.status = status;
    this.title = title;
    this.headers = headers;
  }
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const notFound = (detail) => new HttpError(404, "Not Found", detail);
const invalid = (detail) => new HttpError(422, "Unprocessable Content", detail);

// --- validation ----------------------------------------------------------------------------
// A field spec is the subset of JSON Schema the bodies use. Kept in step with `openapi.mjs` by
// hand: the document is what clients read, this is what the server enforces.

const PRODUCT_FIELDS = {
  sku: { type: "string", min: 1, max: 64, required: true },
  name: { type: "string", min: 1, max: 200, required: true },
  description: { type: "string", nullable: true, max: 2000, default: null },
  category: { type: "string", min: 1, max: 64, required: true },
  price: { type: "number", minimum: 0, required: true },
  stock: { type: "integer", minimum: 0, default: 0 },
};
const STORE_FIELDS = {
  name: { type: "string", min: 1, max: 120, required: true },
  address: { type: "string", min: 1, max: 200, required: true },
  lat: { type: "number", minimum: -90, maximum: 90, required: true },
  lon: { type: "number", minimum: -180, maximum: 180, required: true },
  phone: { type: "string", nullable: true, max: 32, default: null },
  email: { type: "string", nullable: true, max: 120, format: "email", default: null },
};
const REVIEW_FIELDS = {
  rating: { type: "integer", minimum: 1, maximum: 5, required: true },
  author: { type: "string", min: 1, max: 80, required: true },
  comment: { type: "string", max: 2000, default: "" },
  store_id: { type: "integer", nullable: true, minimum: 1, default: null },
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Members the schema does not declare: the request schemas are closed, so they are a 422 and
 * not something quietly dropped — a typo in a field name would otherwise look like a success. */
function undeclared(input, fields) {
  const unknown = Object.keys(input).filter((name) => !(name in fields));
  return unknown.length ? [`unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`] : [];
}

function fieldError(name, value, spec) {
  if (value === null) return spec.nullable ? null : `${name} may not be null`;
  if (spec.type === "string" && typeof value !== "string") return `${name} must be a string`;
  if (spec.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return `${name} must be a number`;
  if (spec.type === "integer" && !Number.isInteger(value)) return `${name} must be an integer`;
  if (typeof value === "string") {
    if (spec.min !== undefined && value.length < spec.min) return `${name} must not be empty`;
    if (spec.max !== undefined && value.length > spec.max) return `${name} is longer than ${spec.max} characters`;
    if (spec.format === "email" && !EMAIL.test(value)) return `${name} is not an email address`;
  }
  if (typeof value === "number") {
    if (spec.minimum !== undefined && value < spec.minimum) return `${name} must be at least ${spec.minimum}`;
    if (spec.maximum !== undefined && value > spec.maximum) return `${name} must be at most ${spec.maximum}`;
  }
  return null;
}

/**
 * A full resource from a body: every required field present and every field valid. Optional
 * fields left out take their defaults — which is what makes PUT a replace and not a merge.
 */
function validateFull(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The body must be a JSON object.");
  const errors = undeclared(input, fields);
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!(name in input)) {
      if (spec.required) errors.push(`${name} is required`);
      else out[name] = spec.default;
      continue;
    }
    const error = fieldError(name, input[name], spec);
    if (error) errors.push(error); else out[name] = input[name];
  }
  if (errors.length) throw invalid(errors.join("; "));
  return out;
}

/** The writable fields a PATCH carries. None at all is a 422, not a 200 that changed nothing. */
function validatePartial(input, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The body must be a JSON object.");
  const errors = undeclared(input, fields);
  const out = {};
  for (const [name, value] of Object.entries(input)) {
    const spec = fields[name];
    if (!spec) continue;
    const error = fieldError(name, value, spec);
    if (error) errors.push(error); else out[name] = value;
  }
  if (errors.length) throw invalid(errors.join("; "));
  if (!Object.keys(out).length) throw invalid(`Send at least one writable field: ${Object.keys(fields).join(", ")}.`);
  return out;
}

// --- query parameters ----------------------------------------------------------------------

function parseLimit(query) {
  const raw = query.get("limit");
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > 100) throw invalid("limit must be an integer between 1 and 100.");
  return value;
}

/** Cursors are opaque to clients but not to the server: anything it did not issue is a 422,
 * never a 500 and never silently the first page. */
function parseCursor(query) {
  const raw = query.get("cursor");
  if (raw === null) return 0;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Number.isInteger(decoded?.offset) || decoded.offset < 0) throw new Error();
    return decoded.offset;
  } catch {
    throw invalid("cursor is not a cursor this API issued.");
  }
}

function parseNumber(query, name, minimum, maximum, { exclusiveMinimum = false } = {}) {
  const raw = query.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  const below = exclusiveMinimum ? value <= minimum : value < minimum;
  if (raw.trim() === "" || !Number.isFinite(value) || below || value > maximum) throw invalid(`${name} must be a number ${exclusiveMinimum ? "greater than" : "from"} ${minimum} ${exclusiveMinimum ? "and up to" : "to"} ${maximum}.`);
  return value;
}

function textParameter(query, name) {
  const raw = query.get(name);
  if (raw === null) return undefined;
  if (raw === "") throw invalid(`${name} must not be empty.`);
  return raw;
}

function page(rows, query, url) {
  const limit = parseLimit(query);
  const offset = parseCursor(query);
  const slice = rows.slice(offset, offset + limit);
  const nextCursor = offset + limit < rows.length ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString("base64url") : null;
  let next = null;
  if (nextCursor) {
    const nextQuery = new URLSearchParams(query);
    nextQuery.set("cursor", nextCursor);
    next = `${url.pathname}?${nextQuery}`;
  }
  return { data: slice, meta: { next_cursor: nextCursor, limit }, links: { next } };
}

function distanceKm(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// --- authentication ------------------------------------------------------------------------

const TOKENS = { "admin-token": "admin", "read-token": "read" };
const API_KEYS = { "demo-key": "api-key" };
/** Users of `POST /auth/login`, whose session cookie is `eq_session`. */
const USERS = { admin: { password: "admin-password", role: "admin" }, reader: { password: "read-password", role: "read" } };
export const SESSION_COOKIE = "eq_session";
/** A session that always exists: what a pasted cookie value is tested with. */
const FIXED_SESSIONS = { "admin-session": "admin", "read-session": "read" };
/** HMAC keys by key id. The signature is `X-Signature`: hex HMAC-SHA256 of
 * `METHOD\npath?query\ntimestamp\nsha256(body)`, with `X-Timestamp` (Unix seconds, ±5 min). */
const HMAC_KEYS = { "demo-hmac": { secret: "hmac-secret", role: "admin" }, "read-hmac": { secret: "hmac-read-secret", role: "read" } };
const HMAC_WINDOW_S = 300;

function cookiesOf(req) {
  return Object.fromEntries(String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]));
}

function hmacRole(req, method, url, raw, challenge) {
  const keyId = req.headers["x-key-id"];
  const key = HMAC_KEYS[String(keyId)];
  if (!key) throw new HttpError(401, "Unauthorized", "The HMAC key id is not known.", challenge);
  const timestamp = String(req.headers["x-timestamp"] ?? "");
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > HMAC_WINDOW_S) throw new HttpError(401, "Unauthorized", "The X-Timestamp is missing or outside the 5-minute window.", challenge);
  const stringToSign = `${method}\n${url.pathname}${url.search}\n${timestamp}\n${createHash("sha256").update(raw).digest("hex")}`;
  const expected = Buffer.from(createHmac("sha256", key.secret).update(stringToSign).digest("hex"));
  const given = Buffer.from(String(req.headers["x-signature"] ?? ""));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "Unauthorized", "The HMAC signature does not match the request.", challenge);
  return key.role;
}

/**
 * 401 is "who are you?" and 403 is "I know who you are, and no". A valid API key sent to a
 * DELETE is a 401: the operation does not accept that kind of credential at all, which is a
 * different finding from a token whose scope falls short.
 *
 * Besides a bearer token or an API key: an HMAC-signed request, a session cookie, or a client
 * certificate the server's CA signed (when it serves TLS), in that order.
 */
function authorize(req, method, url, raw, sessions) {
  const challenge = { "WWW-Authenticate": 'Bearer realm="mock-store"' };
  const authorization = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];
  const session = cookiesOf(req)[SESSION_COOKIE];
  let role;
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    role = match ? TOKENS[match[1].trim()] : undefined;
    if (!role) throw new HttpError(401, "Unauthorized", "The bearer token is not valid.", challenge);
  } else if (typeof apiKey === "string") {
    role = API_KEYS[apiKey];
    if (!role) throw new HttpError(401, "Unauthorized", "The API key is not valid.", challenge);
  } else if (req.headers["x-signature"] !== undefined) {
    role = hmacRole(req, method, url, raw, challenge);
  } else if (session !== undefined) {
    role = FIXED_SESSIONS[session] ?? sessions.get(session);
    if (!role) throw new HttpError(401, "Unauthorized", "The session has expired or is not valid.", challenge);
  } else if (req.socket.authorized) {
    role = "admin";
  } else {
    throw new HttpError(401, "Unauthorized", "This operation needs a bearer token or an API key.", challenge);
  }
  if (role === "api-key" && method === "DELETE") throw new HttpError(401, "Unauthorized", "DELETE does not accept an API key: use a bearer token.", challenge);
  if (role === "read" && method !== "GET") throw new HttpError(403, "Forbidden", "This token has the catalog:read scope only.");
}

// --- routes --------------------------------------------------------------------------------

/**
 * `tls` serves HTTPS; with `ca`, it asks for a client certificate and accepts one that CA signed
 * as the admin (mutual TLS). A connection without one still opens: its requests get the 401.
 *
 * @param {{ auth?: boolean, latencyMs?: number, faults?: { brokenEnvelope?: boolean, validation?: "lenient" | "crash" }, tls?: { cert: string, key: string, ca?: string } }} [options]
 */
export function createMockServer({ auth = false, latencyMs = 0, faults = {}, tls } = {}) {
  let state = seedState();
  /** Session id → role, from `POST /auth/login`. */
  const sessions = new Map();
  const spec = openApiDocument();

  /** A single resource, in its envelope — unless the fault switch says to forget it, which is
   * the kind of regression the schema assertion has to catch. */
  const one = (row, status = 200) => ({ status, body: faults.brokenEnvelope ? { ...row } : { data: row } });

  /** Body validation — unless the fault switch says to accept whatever comes (`lenient`) or to
   * break on it (`crash`): the two regressions the negative cases have to catch. */
  const withFaults = (validate) => (input, fields) => {
    try {
      return validate(input, fields);
    } catch (error) {
      if (faults.validation === "crash") throw new TypeError(`Cannot read properties of undefined (${error.message})`);
      if (faults.validation === "lenient" && input && typeof input === "object" && !Array.isArray(input)) return { ...Object.fromEntries(Object.entries(fields).filter(([, spec]) => !spec.required).map(([name, spec]) => [name, spec.default])), ...input };
      throw error;
    }
  };
  const full = withFaults(validateFull);
  const partial = withFaults(validatePartial);

  function findProduct(id) {
    const row = state.products.get(Number(id));
    if (!row || !/^\d+$/.test(id)) throw notFound(`There is no product ${id}.`);
    return row;
  }
  function findStore(id) {
    const row = state.stores.get(Number(id));
    if (!row || !/^\d+$/.test(id)) throw notFound(`There is no store ${id}.`);
    return row;
  }
  function findReview(productId, reviewId) {
    findProduct(productId);
    const row = state.reviews.get(Number(reviewId));
    if (!row || !/^\d+$/.test(reviewId) || row.product_id !== Number(productId)) throw notFound(`Product ${productId} has no review ${reviewId}.`);
    return row;
  }
  function assertUniqueSku(sku, exceptId) {
    for (const row of state.products.values()) if (row.sku === sku && row.product_id !== exceptId) throw new HttpError(409, "Conflict", `SKU ${sku} already belongs to product ${row.product_id}.`);
  }
  function assertUniqueStoreName(name, exceptId) {
    for (const row of state.stores.values()) if (row.name === name && row.store_id !== exceptId) throw new HttpError(409, "Conflict", `The store name "${name}" is already taken by store ${row.store_id}.`);
  }
  function assertStoreExists(storeId) {
    if (storeId !== null && storeId !== undefined && !state.stores.has(storeId)) throw invalid(`store_id ${storeId} is not an existing store.`);
  }

  const routes = [
    {
      pattern: /^\/health$/, public: true,
      methods: { GET: () => ({ status: 200, body: { status: "ok" } }) },
    },
    {
      pattern: /^\/openapi\.json$/, public: true,
      methods: { GET: () => ({ status: 200, body: spec }) },
    },
    {
      pattern: /^\/v1\/products$/,
      methods: {
        GET: ({ query, url }) => {
          const q = textParameter(query, "q")?.toLowerCase();
          const category = textParameter(query, "category");
          const sku = textParameter(query, "sku");
          const sort = textParameter(query, "sort");
          if (sort !== undefined && !SORTS[sort]) throw invalid(`sort must be one of ${Object.keys(SORTS).join(", ")}.`);
          const rows = [...state.products.values()].filter((row) =>
            (!q || row.name.toLowerCase().includes(q) || (row.description ?? "").toLowerCase().includes(q)) &&
            (!category || row.category === category) &&
            (!sku || row.sku === sku));
          if (sort) rows.sort(SORTS[sort]);
          return { status: 200, body: page(rows, query, url) };
        },
        POST: ({ body }) => {
          const fields = full(body, PRODUCT_FIELDS);
          assertUniqueSku(fields.sku);
          const row = { product_id: state.next.product++, ...fields };
          state.products.set(row.product_id, row);
          return one(row, 201);
        },
      },
    },
    {
      pattern: /^\/v1\/products\/bulk$/,
      methods: {
        POST: ({ body }) => {
          if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("The body must be a JSON object.");
          const extra = undeclared(body, { records: true });
          if (extra.length) throw invalid(extra[0]);
          const records = body.records;
          if (!Array.isArray(records) || records.length < 1 || records.length > 100) throw invalid("records must be a list of 1 to 100 products.");
          // Validated as a whole before anything is written: a bulk that fails halfway would
          // leave the caller unable to tell which records landed.
          const validated = records.map((record, index) => {
            try { return full(record, PRODUCT_FIELDS); } catch (error) { throw error instanceof HttpError ? invalid(`records[${index}]: ${error.message}`) : error; }
          });
          const counters = { created: 0, updated: 0, unchanged: 0 };
          for (const fields of validated) {
            const existing = [...state.products.values()].find((row) => row.sku === fields.sku);
            if (!existing) {
              const row = { product_id: state.next.product++, ...fields };
              state.products.set(row.product_id, row);
              counters.created += 1;
            } else if (Object.entries(fields).every(([key, value]) => existing[key] === value)) {
              counters.unchanged += 1;
            } else {
              Object.assign(existing, fields);
              counters.updated += 1;
            }
          }
          return { status: 200, body: { data: counters } };
        },
      },
    },
    {
      pattern: /^\/v1\/products\/(?<product_id>[^/]+)$/,
      methods: {
        GET: ({ params }) => one(findProduct(params.product_id)),
        PUT: ({ params, body }) => {
          const row = findProduct(params.product_id);
          const fields = full(body, PRODUCT_FIELDS);
          assertUniqueSku(fields.sku, row.product_id);
          Object.assign(row, fields);
          return one(row);
        },
        PATCH: ({ params, body }) => {
          const row = findProduct(params.product_id);
          const fields = partial(body, PRODUCT_FIELDS);
          if (fields.sku !== undefined) assertUniqueSku(fields.sku, row.product_id);
          Object.assign(row, fields);
          return one(row);
        },
        DELETE: ({ params }) => {
          const row = findProduct(params.product_id);
          state.products.delete(row.product_id);
          for (const review of [...state.reviews.values()]) if (review.product_id === row.product_id) state.reviews.delete(review.id);
          return { status: 204 };
        },
      },
    },
    {
      pattern: /^\/v1\/products\/(?<product_id>[^/]+)\/reviews$/,
      methods: {
        GET: ({ params, query, url }) => {
          const product = findProduct(params.product_id);
          return { status: 200, body: page([...state.reviews.values()].filter((row) => row.product_id === product.product_id), query, url) };
        },
        POST: ({ params, body }) => {
          const product = findProduct(params.product_id);
          const fields = full(body, REVIEW_FIELDS);
          assertStoreExists(fields.store_id);
          const row = { id: state.next.review++, product_id: product.product_id, ...fields };
          state.reviews.set(row.id, row);
          return one(row, 201);
        },
      },
    },
    {
      pattern: /^\/v1\/products\/(?<product_id>[^/]+)\/reviews\/(?<review_id>[^/]+)$/,
      methods: {
        GET: ({ params }) => one(findReview(params.product_id, params.review_id)),
        DELETE: ({ params }) => {
          state.reviews.delete(findReview(params.product_id, params.review_id).id);
          return { status: 204 };
        },
      },
    },
    {
      pattern: /^\/v1\/stores$/,
      methods: {
        GET: ({ query, url }) => {
          const lat = parseNumber(query, "lat", -90, 90);
          const lon = parseNumber(query, "lon", -180, 180);
          const radius = parseNumber(query, "radius_km", 0, 100, { exclusiveMinimum: true });
          // Half a geographic search is a client bug, and answering it with the unfiltered list
          // would hide that bug behind a 200.
          if ((lat === undefined) !== (lon === undefined)) throw invalid("lat and lon go together: send both or neither.");
          if (radius !== undefined && lat === undefined) throw invalid("radius_km needs lat and lon.");
          let rows = [...state.stores.values()];
          if (lat !== undefined && lon !== undefined) {
            const centre = { lat, lon };
            const limitKm = radius ?? DEFAULT_RADIUS_KM;
            rows = rows
              .map((row) => ({ ...row, distance_km: Math.round(distanceKm(centre, row) * 1000) / 1000 }))
              .filter((row) => row.distance_km <= limitKm)
              .sort((a, b) => a.distance_km - b.distance_km);
          }
          return { status: 200, body: page(rows, query, url) };
        },
        POST: ({ body }) => {
          const fields = full(body, STORE_FIELDS);
          assertUniqueStoreName(fields.name);
          const row = { store_id: state.next.store++, ...fields };
          state.stores.set(row.store_id, row);
          return one(row, 201);
        },
      },
    },
    {
      pattern: /^\/v1\/stores\/(?<store_id>[^/]+)$/,
      methods: {
        GET: ({ params }) => one(findStore(params.store_id)),
        PUT: ({ params, body }) => {
          const row = findStore(params.store_id);
          const fields = full(body, STORE_FIELDS);
          assertUniqueStoreName(fields.name, row.store_id);
          Object.assign(row, fields);
          return one(row);
        },
        PATCH: ({ params, body }) => {
          const row = findStore(params.store_id);
          const fields = partial(body, STORE_FIELDS);
          if (fields.name !== undefined) assertUniqueStoreName(fields.name, row.store_id);
          Object.assign(row, fields);
          return one(row);
        },
        DELETE: ({ params }) => {
          const row = findStore(params.store_id);
          state.stores.delete(row.store_id);
          // A review keeps its text when the store it mentions closes; only the link goes.
          for (const review of state.reviews.values()) if (review.store_id === row.store_id) review.store_id = null;
          return { status: 204 };
        },
      },
    },
  ];

  async function readRaw(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  function parseBody(raw) {
    const text = raw.toString("utf8");
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { throw invalid("The body is not valid JSON."); }
  }

  /**
   * `POST /auth/login` with `{ "username", "password" }` (JSON or a form) answers 204 and a
   * session cookie. Outside the contract on purpose: it is how a cookie credential logs in, not
   * an operation of the store.
   */
  function login(req, raw) {
    const text = raw.toString("utf8");
    let input;
    if (String(req.headers["content-type"] ?? "").includes("x-www-form-urlencoded")) input = Object.fromEntries(new URLSearchParams(text));
    else { try { input = text ? JSON.parse(text) : {}; } catch { throw invalid("The body is not valid JSON."); } }
    const user = USERS[String(input?.username ?? "")];
    if (!user || user.password !== input?.password) throw new HttpError(401, "Unauthorized", "Wrong username or password.");
    const id = randomBytes(16).toString("hex");
    sessions.set(id, user.role);
    return { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax` } };
  }

  async function handle(req) {
    const url = new URL(req.url ?? "/", "http://mock-store.local");
    const method = (req.method ?? "GET").toUpperCase();
    if (url.pathname === "/auth/login") {
      if (method !== "POST") throw new HttpError(405, "Method Not Allowed", `${method} is not supported on ${url.pathname}.`, { Allow: "POST" });
      return login(req, await readRaw(req));
    }
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      const handler = route.methods[method];
      if (!handler) throw new HttpError(405, "Method Not Allowed", `${method} is not supported on ${url.pathname}.`, { Allow: Object.keys(route.methods).join(", ") });
      // The raw body is read first: an HMAC signature covers its bytes.
      const raw = await readRaw(req);
      // Authentication comes before anything that could reveal whether a resource exists.
      if (auth && !route.public) authorize(req, method, url, raw, sessions);
      const body = ["POST", "PUT", "PATCH"].includes(method) ? parseBody(raw) : undefined;
      return handler({ params: match.groups ?? {}, query: url.searchParams, url, body });
    }
    throw notFound(`No route for ${url.pathname}.`);
  }

  const listener = async (req, res) => {
    let result;
    try {
      result = await handle(req);
    } catch (error) {
      const known = error instanceof HttpError ? error : new HttpError(500, "Internal Server Error", "Unexpected error.");
      if (!(error instanceof HttpError) && !faults.validation) console.error(error);
      result = { status: known.status, problem: true, headers: known.headers, body: { type: `${PROBLEM_BASE}/${slug(known.title)}`, title: known.title, status: known.status, detail: known.message } };
    }
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    // Drain whatever body a rejected request still carries, so keep-alive connections stay usable.
    req.resume();
    const headers = { ...(result.headers ?? {}) };
    if (result.status === 204 || result.body === undefined) {
      res.writeHead(result.status, headers);
      res.end();
      return;
    }
    const payload = JSON.stringify(result.body);
    headers["Content-Type"] = result.problem ? "application/problem+json" : "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
    res.writeHead(result.status, headers);
    res.end(payload);
  };
  const server = tls ? https.createServer({ cert: tls.cert, key: tls.key, ...(tls.ca ? { ca: tls.ca, requestCert: true, rejectUnauthorized: false } : {}) }, listener) : http.createServer(listener);

  return {
    server,
    /** @param {number} [port] 0 picks a free one. @param {string} [host] */
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = /** @type {import("node:net").AddressInfo} */ (server.address());
          resolve({ port: address.port, url: `${tls ? "https" : "http"}://${host}:${address.port}` });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    },
    /** Back to the seed: what a test calls between runs that must start from the same data. */
    reset() {
      state = seedState();
    },
    /** Forgets every login session: the next request with one gets a 401, as when it expires. */
    expireSessions() {
      sessions.clear();
    },
  };
}
