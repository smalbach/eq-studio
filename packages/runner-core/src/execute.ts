/**
 * One request of a case, and every assertion about its response.
 *
 * Runs wherever there is a `fetch`: behind the dashboard's `/api/run`, in a test, in the CLI.
 * The response is checked against the schema the API's own OpenAPI document declares for that
 * operation and status; only when the document declares none does a weaker shape check stand in
 * (the envelope member, an empty body, Problem Details).
 */
import { latencyAssertion, percentile } from "./budgets.mjs";
import { responseSchema, validateJson } from "./contract.mjs";
import { tr } from "./i18n.mjs";
import type { Budget, Locale } from "./types.ts";

export type Assertion = { label: string; pass: boolean; detail: string; informative?: boolean };

export type CaseRequest = {
  baseUrl: string;
  method: string;
  /** The resolved path, with its query string. */
  path: string;
  /** The templated path, as the OpenAPI document names it. */
  operationPath: string;
  expectedStatus: number;
  /** Any of these passes, when a case accepts more than one; `expectedStatus` otherwise. */
  expectedStatuses?: number[];
  body?: unknown;
  /** Sent exactly as written, as JSON, in place of `body`: a body that is not valid JSON. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** The credential the OpenAPI document is read with. Not the case's own headers: a 401 case
   * sends none on purpose, and the document may sit behind the same authentication. */
  specHeaders?: Record<string, string>;
  /** Where the OpenAPI document lives: a path under the base URL, or an absolute URL. */
  specUrl?: string;
  /** `No body`, `ProblemDetails`, or anything else for a success response. */
  responseShape?: string;
  /** The envelope member a success response wraps its payload in; empty for none. */
  envelopeKey?: string;
  samples?: number;
  internal?: boolean;
  budget?: Budget | null;
  enforceLatency?: boolean;
  timeoutMs?: number;
  locale?: Locale;
};

export type CaseResult = {
  ok: boolean;
  durationMs: number;
  error?: string;
  latency?: { samples: number[]; p50: number; p95: number; budgetMs: number | null };
  request: { method: string; url: string; headers?: Record<string, string>; body: unknown };
  expected: Record<string, unknown>;
  actual: null | { status: number; statusText: string; contentType: string; headers: Record<string, string>; body: unknown };
  assertions: Assertion[];
  step?: string;
};

/**
 * The URL of a path under a base URL. Concatenated, not resolved: `new URL("/x", base)` would
 * replace the base's own path, and an API published under `/gateway/api` would lose it.
 */
export function resolveTarget(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return new URL(path);
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${base.origin}${prefix}${suffix}`);
}

export const DEFAULT_SPEC_PATH = "/openapi.json";

/**
 * The OpenAPI document once per minute per target and credential, not once per case: a matrix
 * of a few hundred cases would otherwise fetch it a few hundred times. Only a document that
 * loaded is kept; a failure is retried on the next case.
 */
const SPEC_TTL_MS = 60_000;
const specCache = new Map<string, { at: number; spec: Record<string, unknown> }>();

async function loadSpec(fetchImpl: typeof fetch, url: URL, headers: Record<string, string>, locale: Locale) {
  const key = `${url}|${headers.Authorization ?? ""}|${Object.keys(headers).sort().join(",")}`;
  const cached = specCache.get(key);
  if (cached && Date.now() - cached.at < SPEC_TTL_MS) return cached.spec;
  const response = await fetchImpl(url, { headers: { Accept: "application/json", ...headers } });
  if (!response.ok) throw new Error(tr(locale, `${url.pathname} respondió ${response.status}`, `${url.pathname} answered ${response.status}`));
  const spec = await response.json() as Record<string, unknown>;
  specCache.set(key, { at: Date.now(), spec });
  return spec;
}

/** Forgets every cached OpenAPI document; for tests that change the document between runs. */
export function clearSpecCache() {
  specCache.clear();
}

const SECRET_HEADER = /authorization|api-key|apikey|token|cookie|secret/i;

/** What the status assertion says. For a case that sends bad input on purpose, a 2xx and a 5xx
 * each get their own diagnosis: the first accepted the input, the second broke on it. */
function statusDetail(status: number, matches: boolean, accepted: number[], rejectsInput: boolean, locale: Locale) {
  const received = tr(locale, `Recibido ${status}`, `Received ${status}`);
  if (matches || !rejectsInput) return received;
  if (status >= 500) return tr(locale, `${received}: una entrada inválida debe ser un 4xx (${accepted.join("/")}), nunca un error del servidor`, `${received}: invalid input must be a 4xx (${accepted.join("/")}), never a server error`);
  if (status < 300) return tr(locale, `${received}: la API aceptó una entrada inválida`, `${received}: the API accepted invalid input`);
  return received;
}

export async function executeCase(input: CaseRequest, fetchImpl: typeof fetch = fetch): Promise<CaseResult> {
  const locale: Locale = input.locale === "en" ? "en" : "es";
  const t = <V,>(es: V, en: V) => tr(locale, es, en);
  const started = performance.now();
  try {
    const base = new URL(input.baseUrl);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error(t("Solo se permiten URLs HTTP o HTTPS.", "Only HTTP or HTTPS URLs are allowed."));
    const target = resolveTarget(input.baseUrl, input.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000);
    const method = input.method.toUpperCase();
    const supportsBody = !["GET", "HEAD"].includes(method);
    const headers = { Accept: "application/json", ...(input.headers ?? {}) } as Record<string, string>;
    const payload = input.rawBody ?? (input.body !== undefined ? JSON.stringify(input.body) : undefined);
    if (supportsBody && payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(target, { method, headers, body: supportsBody ? payload : undefined, signal: controller.signal });
    clearTimeout(timeout);
    // Extra samples are taken **only on safe methods**. Repeating a POST would create N
    // resources and repeating a DELETE would 404 on the second one: the measurement would
    // change the thing being measured. The first sample is the response that gets asserted;
    // the rest only feed the percentile.
    const latencies: number[] = [Math.round(performance.now() - started)];
    const wanted = Math.min(50, Math.max(1, Math.round(input.samples ?? 1)));
    if (wanted > 1 && !supportsBody) {
      for (let i = 1; i < wanted; i += 1) {
        const sampleStarted = performance.now();
        try {
          const extra = await fetchImpl(target, { method, headers });
          await extra.arrayBuffer();
          latencies.push(Math.round(performance.now() - sampleStarted));
        } catch {
          break;
        }
      }
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    let body: unknown = raw;
    if (contentType.includes("json") && raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const accepted = input.expectedStatuses?.length ? input.expectedStatuses : [input.expectedStatus];
    const statusMatches = accepted.includes(response.status);
    // The status the response is checked against: the one received, when it is one of those
    // accepted, so a 404 accepted in place of a 422 is validated against the 404's schema.
    const checkedStatus = statusMatches ? response.status : input.expectedStatus;
    const isObject = typeof body === "object" && body !== null;
    const record = (isObject ? body : {}) as Record<string, unknown>;
    const shape = input.responseShape ?? "";
    const envelopeKey = input.envelopeKey ?? "";
    const envelopeMatches = shape === "No body"
      ? raw.length === 0
      : shape === "ProblemDetails"
        ? isObject && "status" in record && "title" in record
        : envelopeKey ? isObject && envelopeKey in record : isObject;
    // The 405 of an operation the API does not route yet is its own diagnosis: nothing
    // downstream — envelope, schema, content type — says anything useful about a response the
    // API never produced.
    const notImplemented = response.status === 405;
    let expectedSchema: unknown = null;
    let schemaValid: boolean | null = null;
    let schemaErrors: string[] | null = null;
    let specError: string | null = null;
    try {
      const spec = await loadSpec(fetchImpl, resolveTarget(input.baseUrl, input.specUrl || DEFAULT_SPEC_PATH), input.specHeaders ?? {}, locale);
      const declaredSchema = responseSchema(spec, input.operationPath, input.method, checkedStatus, contentType);
      if (declaredSchema) {
        expectedSchema = declaredSchema;
        schemaErrors = validateJson(body, expectedSchema, "$", [], locale);
        schemaValid = schemaErrors.length === 0;
      } else if (shape === "No body") {
        schemaValid = raw.length === 0;
      }
    } catch (error) {
      specError = error instanceof Error ? error.message : t("No se pudo cargar el documento OpenAPI", "Could not load the OpenAPI document");
    }
    const contentTypeMatches = shape === "No body" || contentType.includes("json");
    const durationMs = latencies[0];
    const budget = input.budget ?? null;
    // No budget means no assertion: a green tick that asserts nothing is worse than none.
    const latency = notImplemented ? null : latencyAssertion(budget, latencies, { enforce: input.enforceLatency !== false, locale });
    const schemaPass = notImplemented ? false : schemaValid ?? envelopeMatches;
    const shapeName = shape || (envelopeKey ? `{ ${envelopeKey} }` : "JSON");
    const schemaDetail = notImplemented
      ? t("No evaluado: la API respondió 405", "Not evaluated: the API answered 405")
      : input.internal && schemaValid === null
        ? envelopeMatches ? t(`Fuera del contrato: forma ${shapeName} verificada`, `Outside the contract: ${shapeName} shape verified`) : t(`Fuera del contrato: la respuesta no tiene la forma ${shapeName}`, `Outside the contract: the response does not have the ${shapeName} shape`)
        : specError
          ? t(`No se pudo cargar el schema: ${specError}. Se verificó la forma ${shapeName}`, `Could not load the schema: ${specError}. The ${shapeName} shape was verified`)
          : schemaValid === null
            ? t(`OpenAPI no declara ${checkedStatus} para esta operación; se verificó la forma ${shapeName}`, `OpenAPI declares no ${checkedStatus} for this operation; the ${shapeName} shape was verified`)
            : schemaValid
              ? t("JSON válido contra el schema", "JSON valid against the schema")
              : (schemaErrors ?? []).join(" · ");
    return {
      // `schemaPass` already falls back to the envelope check when the document declares no
      // schema. Requiring the envelope on top of a declared schema would fail an operation the
      // contract says is unwrapped (a health check) with no failing assertion to show for it.
      ok: statusMatches && contentTypeMatches && schemaPass && (!latency || latency.pass || Boolean(latency.informative)),
      durationMs,
      request: { method: input.method, url: target.toString(), headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, SECRET_HEADER.test(key) ? "••••••••" : value])), body: input.rawBody ?? input.body ?? null },
      expected: { status: input.expectedStatus, responseShape: shape, contentType: shape === "No body" ? null : shape === "ProblemDetails" ? "application/problem+json" : "application/json", schema: expectedSchema, schemaDiagnostic: specError ?? (notImplemented ? t("La API respondió 405: la operación no está implementada", "The API answered 405: the operation is not implemented") : schemaValid === null ? t(`OpenAPI no declara ${checkedStatus} para esta operación`, `OpenAPI declares no ${checkedStatus} for this operation`) : null), ...(accepted.length > 1 ? { statuses: accepted } : {}) },
      actual: { status: response.status, statusText: response.statusText, contentType, headers: Object.fromEntries(response.headers.entries()), body },
      assertions: [
        { label: `Status ${accepted.join(" | ")}`, pass: statusMatches, detail: notImplemented ? t(`Recibido 405: ${method} ${input.operationPath} no está implementado en la API`, `Received 405: ${method} ${input.operationPath} is not implemented in the API`) : statusDetail(response.status, statusMatches, accepted, input.expectedStatuses !== undefined, locale) },
        { label: "Schema OpenAPI", pass: schemaPass, detail: schemaDetail },
        { label: "Content-Type", pass: contentTypeMatches, detail: contentType || t("Sin Content-Type", "No Content-Type") },
        ...(latency ? [latency] : []),
      ],
      latency: { samples: latencies, p50: percentile(latencies, 50), p95: percentile(latencies, 95), budgetMs: budget?.ms ?? null },
    };
  } catch (error) {
    return { ok: false, durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : t("No se pudo ejecutar la solicitud", "Could not run the request"), request: { method: input.method, url: `${input.baseUrl}${input.path}`, body: input.rawBody ?? input.body ?? null }, expected: { status: input.expectedStatus, responseShape: input.responseShape }, actual: null, assertions: [{ label: t("Conexión con la API", "API connection"), pass: false, detail: t("La API no respondió", "The API did not answer") }] };
  }
}
