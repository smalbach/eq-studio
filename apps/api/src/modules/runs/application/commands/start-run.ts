import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import { buildQueue } from "@eq/runner-core";
import type { RunCaseRow, RunRow } from "../../../../database/entities.ts";
import { Invalid } from "../../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { RunQueued } from "../../../shared/events.ts";
import { emptyTotals, type FunctionalPlan, type LoadPlan } from "../../domain/run.ts";
import { RunRepository } from "../../infrastructure/run.repository.ts";
import { RunContextLoader } from "../run-context.ts";
import { LOCAL_ACTOR, requireRole, type Actor } from "../../../../shared/rbac.ts";

export class StartRunCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly plan: FunctionalPlan, readonly scope: string | undefined, readonly triggeredBy: string, readonly actor: Actor = LOCAL_ACTOR) {} }

/**
 * Plans a functional run and queues it. The queue is built **now**, from the active contract,
 * and stored case by case: what the run will do is visible (and asserted) before it starts, and
 * a run reopened later shows exactly the cases it had. Answers with the run id at once; the run
 * itself executes in the background.
 */
@CommandHandler(StartRunCommand)
export class StartRunHandler implements ICommandHandler<StartRunCommand, { id: string; total: number }> {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource, @Inject(RunContextLoader) private readonly contexts: RunContextLoader, @Inject(RunRepository) private readonly runs: RunRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, environmentId, plan, scope, triggeredBy, actor }: StartRunCommand) {
    const context = await this.contexts.load(workspaceId, projectId, environmentId);
    // A run that can write to an environment is an admin's call; the guard let editors in for reads.
    if (!plan.readOnly && context.settings.writesAllowed) requireRole(actor, "admin", "A run with writes");
    const authEnabled = plan.authEnabled ?? context.settings.authEnabled;
    const endpoints = context.endpoints.filter((endpoint) => !plan.readOnly || endpoint.method === "GET");
    const queue = buildQueue(endpoints, context.config, { mode: plan.mode, customOrder: plan.customOrder, endpointIds: plan.endpointIds, caseSelection: plan.caseSelection, authEnabled, locale: plan.locale });
    if (!queue.length) throw new Invalid("The selection has no cases to run");
    const id = uuidv7();
    const run: RunRow = { id, workspaceId, projectId: context.project.id, environmentId: context.environment.id, specVersionId: context.specVersionId, kind: "functional", status: "queued", scope: scope ?? (plan.readOnly ? "GET matrix" : plan.endpointIds ? `Selection of ${plan.endpointIds.length} endpoints` : "Full matrix"), plan: { ...plan, authEnabled }, totals: emptyTotals(queue.length), report: null, error: null, triggeredBy, createdAt: isoNow(), startedAt: null, finishedAt: null, durationMs: null };
    const cases: RunCaseRow[] = queue.map(({ endpoint, scenario }, position) => ({ id: uuidv7(), runId: id, position, operationId: endpoint.id, scenarioId: scenario.id, name: scenario.name, method: endpoint.method, path: endpoint.path, expectedStatus: scenario.expectedStatus, status: "queued", durationMs: null, steps: null }));
    await this.db.transaction((tx) => this.runs.insert(run, cases, tx));
    this.events.publish(new RunQueued(workspaceId, run.projectId, id, "functional"));
    return { id, total: queue.length };
  }
}

export class StartLoadRunCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly plan: LoadPlan, readonly triggeredBy: string) {} }

/** Queues a load, stress, spike or soak test. Its targets and data are resolved when it runs. */
@CommandHandler(StartLoadRunCommand)
export class StartLoadRunHandler implements ICommandHandler<StartLoadRunCommand, { id: string }> {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource, @Inject(RunContextLoader) private readonly contexts: RunContextLoader, @Inject(RunRepository) private readonly runs: RunRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, environmentId, plan, triggeredBy }: StartLoadRunCommand) {
    const context = await this.contexts.load(workspaceId, projectId, environmentId);
    const id = uuidv7();
    const run: RunRow = { id, workspaceId, projectId: context.project.id, environmentId: context.environment.id, specVersionId: context.specVersionId, kind: "load", status: "queued", scope: `${plan.type}${plan.mixId ? ` · ${plan.mixId}` : ""}`, plan: plan as unknown as Record<string, unknown>, totals: emptyTotals(0), report: null, error: null, triggeredBy, createdAt: isoNow(), startedAt: null, finishedAt: null, durationMs: null };
    await this.db.transaction((tx) => this.runs.insert(run, [], tx));
    this.events.publish(new RunQueued(workspaceId, run.projectId, id, "load"));
    return { id };
  }
}
