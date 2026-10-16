import { Inject, Injectable } from "@nestjs/common";
import { EventBus } from "@nestjs/cqrs";
import { createScenarioRunner, directExecutor, discoverIds, executeCase, runnableScenarios, type CaseResult, type Endpoint, type ExecutionEnvironment, type TestScenario } from "@eq/runner-core";
import { buildStages, dataKeysOf, defaultLoadData, discoverLoadData, loadCatalog, loadMixes, preflight, runLoad, validatePlan } from "@eq/runner-core/load";
import type { RunRow } from "../../../database/entities.ts";
import { isoNow } from "../../../shared/ids.ts";
import { HTTP_FETCH } from "../../../shared/tokens.ts";
import { RunCaseFinished, RunFinished, RunStarted } from "../../shared/events.ts";
import { BLOCKED_LABEL, caseStatus, countCase, emptyTotals, stepRecord, verdict, type FunctionalPlan, type LoadPlan } from "../domain/run.ts";
import { RunRepository } from "../infrastructure/run.repository.ts";
import { RunContextLoader, type RunContext } from "./run-context.ts";

/**
 * Executes one run, server-side: the browser that started it is only an observer, and closing
 * it changes nothing. Progress is written to the database case by case, which is also what the
 * stream reads — so any API process can serve the stream of a run another one executes.
 *
 * Stopping is graceful: cancellation is checked between cases, so a chained write flow always
 * finishes its cleanup instead of leaving the row it created behind.
 */
@Injectable()
export class RunExecutor {
  constructor(
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(RunContextLoader) private readonly contexts: RunContextLoader,
    @Inject(EventBus) private readonly events: EventBus,
    @Inject(HTTP_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  async execute(runId: string) {
    const run = await this.runs.get(runId);
    if (!run) return;
    if (run.status === "cancelling") { await this.finish(run, "cancelled"); return; }
    if (run.status !== "queued") return;
    const startedAt = isoNow();
    await this.runs.update(run.id, { status: "running", startedAt });
    this.events.publish(new RunStarted(run.workspaceId, run.id));
    try {
      const context = await this.contexts.load(run.workspaceId, run.projectId, run.environmentId, run.specVersionId);
      if (run.kind === "functional") await this.functional(run, context);
      else await this.load(run, context);
    } catch (error) {
      await this.runs.updateCasesWhere(run.id, ["queued", "running"], "skipped");
      await this.finish(run, "error", error instanceof Error ? error.message : String(error));
    }
  }

  private async cancelled(runId: string) {
    return (await this.runs.status(runId)) === "cancelling";
  }

  private async finish(run: RunRow, status: RunRow["status"], error: string | null = null, extra: Partial<RunRow> = {}) {
    const finishedAt = isoNow();
    const started = (await this.runs.get(run.id))?.startedAt ?? finishedAt;
    await this.runs.update(run.id, { status, error, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(started), ...extra });
    this.events.publish(new RunFinished(run.workspaceId, run.id, status));
  }

  /** The environment as the engine's executor sees it, ids discovered when it is not the seed. */
  private async environment(context: RunContext, locale: "es" | "en", samples: number) {
    const credentials = await this.contexts.credentials(context);
    const env: ExecutionEnvironment = { baseUrl: context.environment.baseUrl, specUrl: context.environment.specUrl ?? undefined, specHeaders: credentials.specHeaders, credentialsFor: (scenario) => credentials.headersFor(scenario.auth), fetchFor: (scenario) => credentials.fetchFor(scenario.auth), specFetch: credentials.specFetch, samples, enforceLatency: context.settings.enforceLatency, locale };
    let empty: string[] = [];
    if (!context.settings.seeded) {
      const config = context.config;
      const found = await discoverIds(config.seed?.sources ?? [], async (path, operationPath) => {
        const result = await executeCase({ baseUrl: env.baseUrl, method: "GET", path, operationPath, expectedStatus: 200, headers: credentials.specHeaders, specHeaders: credentials.specHeaders, specUrl: env.specUrl, envelopeKey: config.envelope?.dataKey ?? "data", enforceLatency: false }, credentials.specFetch);
        return result.actual ? { status: result.actual.status, body: result.actual.body } : null;
      }, config.envelope);
      env.lists = found.lists;
      empty = found.empty;
    }
    return { env, credentials, empty };
  }

  /**
   * The engine's scenario runner against an environment: credentials, discovered ids, and the
   * write guard. `editorBody` is what a case marked `useEditorBody` sends instead of its own.
   */
  async scenarioRunner(context: RunContext, locale: "es" | "en", samples: number, editorBody?: unknown) {
    const { env, empty } = await this.environment(context, locale, samples);
    const direct = directExecutor(context.config, env, this.fetchImpl);
    // The engine refuses the writes an environment does not allow, before they leave: not the
    // UI, which a script or another client would simply not have.
    const execute = async (endpoint: Endpoint, scenario: TestScenario, parameters?: Record<string, string>, options?: { body?: Record<string, unknown>; useEditorBody?: boolean }): Promise<CaseResult> => {
      if (endpoint.method !== "GET" && !context.settings.writesAllowed) {
        return { ok: false, durationMs: 0, request: { method: endpoint.method, url: `${env.baseUrl}${endpoint.path}`, body: null }, expected: { status: scenario.expectedStatus }, actual: null, assertions: [{ label: BLOCKED_LABEL, pass: false, detail: "This environment does not allow POST, PUT, PATCH or DELETE" }] };
      }
      return direct(endpoint, scenario, parameters, { body: options?.useEditorBody && editorBody !== undefined ? editorBody as Record<string, unknown> : options?.body });
    };
    return createScenarioRunner(context.endpoints, context.config, execute, () => {}, (name) => context.settings.seeded || !empty.includes(name), locale);
  }

  private async functional(run: RunRow, context: RunContext) {
    const plan = run.plan as unknown as FunctionalPlan;
    const runner = await this.scenarioRunner(context, plan.locale, plan.samples);
    const byId = new Map(context.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const cases = await this.runs.casesOf(run.id, false);
    let totals = emptyTotals(cases.length);
    let stopped = false;
    for (const [index, item] of cases.entries()) {
      if (await this.cancelled(run.id)) { stopped = true; break; }
      const endpoint = byId.get(item.operationId);
      // Generated again from the configuration: a case removed from it since the run was
      // planned is skipped, never run with a definition that no longer exists.
      const scenario = endpoint ? runnableScenarios(endpoint, context.config, true, plan.locale).find((candidate) => candidate.id === item.scenarioId) : undefined;
      if (!endpoint || !scenario) {
        await this.runs.updateCase(item.id, { status: "skipped" });
        continue;
      }
      await this.runs.updateCase(item.id, { status: "running" });
      const result = await runner.runScenario(endpoint, scenario, { ...(scenario.parameters ?? {}) });
      const status = caseStatus(result.ok, result.steps);
      await this.runs.updateCase(item.id, { status, durationMs: result.durationMs, steps: result.steps.map((step) => stepRecord(step, !result.ok)) });
      totals = countCase(totals, status);
      await this.runs.update(run.id, { totals });
      this.events.publish(new RunCaseFinished(run.workspaceId, run.id, item.id, status));
      if (plan.delayMs > 0 && index < cases.length - 1) await this.pause(plan.delayMs, run.id);
    }
    if (stopped) {
      await this.runs.updateCasesWhere(run.id, ["queued"], "skipped");
      await this.finish(run, "cancelled");
    } else {
      await this.finish(run, verdict(totals));
    }
  }

  /** The delay between cases, cut short by a cancellation. */
  private async pause(ms: number, runId: string) {
    for (let left = ms; left > 0; left -= 250) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, left)));
      if (await this.cancelled(runId)) return;
    }
  }

  private async load(run: RunRow, context: RunContext) {
    const plan = run.plan as unknown as LoadPlan;
    const { credentials } = await this.environment(context, plan.locale, 1);
    const loadConfig = context.project.load ?? {};
    const catalog = loadCatalog(context.config.operations, loadConfig);
    const mixes = loadMixes(catalog, loadConfig);
    const targets = (plan.targets ?? (mixes.find((mix) => mix.id === plan.mixId) ?? mixes[0])?.targets ?? []).filter((target) => target.weight > 0);
    const dataKeys = dataKeysOf(catalog);
    let data: Record<string, string[]> = plan.data ?? defaultLoadData(dataKeys, loadConfig, catalog);
    if (!plan.data && !context.settings.seeded) {
      const found = await discoverLoadData(async (path, operationPath) => {
        const result = await executeCase({ baseUrl: context.environment.baseUrl, method: "GET", path, operationPath, expectedStatus: 200, headers: credentials.specHeaders, specHeaders: credentials.specHeaders, specUrl: context.environment.specUrl ?? undefined, envelopeKey: context.config.envelope?.dataKey ?? "data", enforceLatency: false }, credentials.specFetch);
        return result.actual ? { status: result.actual.status, body: result.actual.body } : null;
      }, context.config.seed?.sources ?? [], context.config.envelope);
      data = { ...data, ...Object.fromEntries(Object.entries(found.data).filter(([, values]) => values.length)) };
    }
    const stages = buildStages(plan.type, { baseRps: plan.baseRps, peakRps: plan.peakRps, durationS: plan.durationS }, plan.locale);
    const latency = plan.latency.mode === "project" ? { mode: "project", rules: context.config.budgets ?? [] } : plan.latency;
    const loadPlan = { locale: plan.locale, baseUrl: context.environment.baseUrl, type: plan.type, headers: credentials.headersFor("default"), targets, data, stages, maxInFlight: plan.maxInFlight, timeoutMs: plan.timeoutMs, latency, zipf: dataKeys };
    const problems = validatePlan(loadPlan, plan.locale);
    if (problems.length) { await this.finish(run, "error", problems.join(" ")); return; }
    let checks: { ok: boolean }[] = [];
    if (plan.onPreflightFailure !== "ignore") {
      checks = await preflight(loadPlan, { fetchImpl: credentials.fetchFor("default") });
      const failed = new Set(checks.flatMap((check, index) => check.ok ? [] : [index]));
      if (failed.size && plan.onPreflightFailure === "stop") { await this.finish(run, "error", `Preflight: ${failed.size} of ${checks.length} targets do not answer as expected; no load was sent`, { report: { preflight: checks } }); return; }
      loadPlan.targets = loadPlan.targets.filter((_, index) => !failed.has(index));
      if (!loadPlan.targets.length) { await this.finish(run, "error", "No target passed the preflight", { report: { preflight: checks } }); return; }
    }
    let aborted = false;
    const windows: unknown[] = [];
    let lastWrite = 0;
    const report = await runLoad(loadPlan, {
      // The primary credential's connection: an HMAC signature per request, a renewed token.
      fetchImpl: credentials.fetchFor("default"),
      isAborted: () => aborted,
      onTick: async (tick: object) => {
        const event = tick as { type?: string; window?: unknown };
        if (event.type !== "tick" || !event.window) return;
        windows.push(event.window);
        // Live progress for the stream, at most once a second; cancellation is read at the same time.
        if (Date.now() - lastWrite >= 900) {
          lastWrite = Date.now();
          aborted = aborted || await this.cancelled(run.id);
          await this.runs.update(run.id, { report: { live: true, preflight: checks, windows } });
        }
      },
    });
    const status = report.aborted || aborted ? "cancelled" : report.verdict.pass ? "passed" : "failed";
    const overall = report.overall;
    await this.finish(run, status, null, { report: { ...report, preflight: checks }, totals: { total: overall.sent ?? overall.completed, completed: overall.completed, passed: overall.completed - overall.errors, failed: overall.errors, blocked: overall.dropped ?? 0 } });
  }
}
