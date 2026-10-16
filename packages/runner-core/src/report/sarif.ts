/**
 * SARIF 2.1.0, the format GitHub code scanning (and most static-analysis dashboards) ingest.
 *
 * Each failed case is a result: its rule is the scenario's kind (`not-found`, `auth-none`,
 * `create-read`…), its level `error` — `warning` when only the latency budget failed —, and its
 * location the operation (`GET /orders/{id}`) as a logical location. When the contract file is
 * known, a physical location points at it, at the line that declares the operation's path, so
 * code scanning shows the alert next to the contract. Blocked cases are not results: the
 * environment did not allow them, nothing failed. A load test's failed criteria are results of
 * the `load-criterion` rule.
 */
import { tr } from "../i18n.mjs";
import { maskSecrets } from "./mask.ts";
import { failedAssertions, loadSummary, onlyLatency, pathOf, scenarioKind, type ReportCase, type ReportContext, type ReportRun } from "./model.ts";

export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const INFORMATION_URI = "https://github.com/smalbach/eq-studio";

type Level = "error" | "warning" | "note";
type Rule = { id: string; name: string; shortDescription: { text: string }; fullDescription?: { text: string }; defaultConfiguration: { level: Level }; properties: { tags: string[] } };
type Location = { physicalLocation?: { artifactLocation: { uri: string }; region?: { startLine: number } }; logicalLocations: { name: string; fullyQualifiedName: string; kind: string }[] };
type Result = { ruleId: string; ruleIndex: number; level: Level; message: { text: string }; locations: Location[]; partialFingerprints: Record<string, string>; properties: Record<string, unknown> };
export type SarifLog = { $schema: string; version: "2.1.0"; runs: { tool: { driver: { name: string; semanticVersion?: string; informationUri: string; rules: Rule[] } }; automationDetails: { id: string }; invocations: { executionSuccessful: boolean; startTimeUtc?: string; endTimeUtc?: string; toolExecutionNotifications?: { level: Level; message: { text: string } }[] }[]; results: Result[]; properties: Record<string, unknown> }[] };

/** FNV-1a, 64 bits as hex: a stable fingerprint, not a security measure. */
function fingerprint(text: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The 1-based line of the contract that declares an operation: its `operationId` (OpenAPI) or
 * `id` (a project file), else the first line that names its path. */
function lineOf(text: string | undefined, operationId: string | undefined, path: string | undefined) {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/);
  const patterns = [
    ...(operationId ? [new RegExp(`\\b(operationId|id)["']?\\s*:\\s*["']?${literal(operationId)}(["']|\\s*$)`)] : []),
    ...(path ? [new RegExp(`^\\s*["']?${literal(path)}["']?\\s*:`), new RegExp(`["']${literal(path)}["']`)] : []),
  ];
  for (const pattern of patterns) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) return index + 1;
  }
  return undefined;
}

const ruleText = (kind: string, locale: "es" | "en") => kind === "load-criterion"
  ? tr(locale, "Criterio de la prueba de carga", "Load test criterion")
  : kind === "custom" ? tr(locale, "Escenario del proyecto o muestra de parámetro", "Project scenario or parameter sample")
    : kind === "geo" ? tr(locale, "Búsqueda geográfica", "Geographic search")
      : tr(locale, `Escenario «${kind}» del contrato`, `Contract scenario "${kind}"`);

export function sarifReport(input: ReportRun, context: ReportContext): SarifLog {
  const run = maskSecrets(input, context.secrets);
  const locale = context.locale ?? "en";
  const rules: Rule[] = [];
  const ruleIndex = (id: string, level: Level) => {
    let index = rules.findIndex((rule) => rule.id === id);
    if (index < 0) {
      index = rules.push({ id, name: id.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase()), shortDescription: { text: ruleText(id, locale) }, defaultConfiguration: { level }, properties: { tags: ["api", "contract", id === "load-criterion" ? "performance" : "correctness"] } }) - 1;
    }
    return index;
  };
  const physical = (operationId?: string, path?: string): Pick<Location, "physicalLocation"> => {
    if (!context.contract) return {};
    const line = lineOf(context.contract.text, operationId, path);
    return { physicalLocation: { artifactLocation: { uri: context.contract.uri }, ...(line ? { region: { startLine: line } } : {}) } };
  };

  const results: Result[] = [];
  if (run.kind === "functional") {
    for (const item of (run.cases ?? []).filter((candidate: ReportCase) => candidate.status === "failed")) {
      const kind = scenarioKind(item.scenarioId);
      const level: Level = onlyLatency(item) ? "warning" : "error";
      const details = (item.steps ?? []).flatMap((step) => [...(step.error ? [step.error] : []), ...failedAssertions(step).map((assertion) => `${step.method} ${pathOf(step.url)} · ${assertion.label}: ${assertion.detail}`)]);
      const operation = `${item.method} ${item.path}`;
      results.push({
        ruleId: kind, ruleIndex: ruleIndex(kind, "error"), level,
        message: { text: `${operation} — ${item.name} (${item.scenarioId}): ${details.length ? details.slice(0, 4).join(" | ") : tr(locale, "falló", "failed")}` },
        locations: [{ ...physical(item.operationId, item.path), logicalLocations: [{ name: item.operationId, fullyQualifiedName: operation, kind: "function" }] }],
        partialFingerprints: { "eqCase/v1": fingerprint(`${context.project}:${item.operationId}:${item.scenarioId}`) },
        properties: { operationId: item.operationId, scenarioId: item.scenarioId, expectedStatus: item.expectedStatus, durationMs: item.durationMs },
      });
    }
  } else {
    for (const check of (loadSummary(run).verdict?.checks ?? []).filter((candidate) => !candidate.pass)) {
      results.push({
        ruleId: "load-criterion", ruleIndex: ruleIndex("load-criterion", "error"), level: "error",
        message: { text: `${check.label}: ${check.detail}` },
        locations: [{ ...physical(), logicalLocations: [{ name: run.scope, fullyQualifiedName: `${context.project}/${run.scope}`, kind: "module" }] }],
        partialFingerprints: { "eqCase/v1": fingerprint(`${context.project}:load:${check.label}`) },
        properties: { criterion: check.label },
      });
    }
  }
  const crashed = ["error", "interrupted", "cancelled"].includes(run.status);
  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "Endpoint Quality", ...(context.toolVersion ? { semanticVersion: context.toolVersion } : {}), informationUri: INFORMATION_URI, rules } },
      automationDetails: { id: `endpoint-quality/${context.project}/${context.environment}/` },
      invocations: [{
        executionSuccessful: !crashed,
        ...(run.startedAt ? { startTimeUtc: run.startedAt } : {}),
        ...(run.finishedAt ? { endTimeUtc: run.finishedAt } : {}),
        ...(run.error ? { toolExecutionNotifications: [{ level: "error" as Level, message: { text: run.error } }] } : {}),
      }],
      results,
      properties: { runId: run.id, kind: run.kind, scope: run.scope, status: run.status, environment: context.environment, ...(context.contractVersion ? { contractVersion: context.contractVersion } : {}), totals: run.totals },
    }],
  };
}
