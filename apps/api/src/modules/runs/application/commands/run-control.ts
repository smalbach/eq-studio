import { Inject } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Conflict } from "../../../../shared/errors.ts";
import { RUN_QUEUE } from "../../../../shared/tokens.ts";
import { isFinished, type FunctionalPlan, type LoadPlan } from "../../domain/run.ts";
import { RunRepository } from "../../infrastructure/run.repository.ts";
import type { RunQueue } from "../../infrastructure/run-queue.ts";
import { StartLoadRunCommand, StartRunCommand } from "./start-run.ts";
import { LOCAL_ACTOR, requireRole, type Actor } from "../../../../shared/rbac.ts";

export class EnqueueRunCommand { constructor(readonly runId: string) {} }

/** Hands a queued run to the queue. Dispatched by the orchestration saga, never by a client. */
@CommandHandler(EnqueueRunCommand)
export class EnqueueRunHandler implements ICommandHandler<EnqueueRunCommand, void> {
  constructor(@Inject(RUN_QUEUE) private readonly queue: RunQueue) {}

  async execute({ runId }: EnqueueRunCommand) {
    await this.queue.enqueue(runId);
  }
}

export class CancelRunCommand { constructor(readonly workspaceId: string, readonly runId: string) {} }

/**
 * Asks a run to stop. The flag lives in the database, so it reaches the worker wherever it runs;
 * the case in flight finishes (cleanup included) and the rest are skipped.
 */
@CommandHandler(CancelRunCommand)
export class CancelRunHandler implements ICommandHandler<CancelRunCommand, void> {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  async execute({ workspaceId, runId }: CancelRunCommand) {
    const run = await this.runs.require(workspaceId, runId);
    if (isFinished(run.status)) throw new Conflict(`The run already finished (${run.status})`);
    await this.runs.update(run.id, { status: "cancelling" });
  }
}

export class DeleteRunCommand { constructor(readonly workspaceId: string, readonly runId: string) {} }

/** Removes a finished run from the history, with its cases. A run in progress is cancelled first. */
@CommandHandler(DeleteRunCommand)
export class DeleteRunHandler implements ICommandHandler<DeleteRunCommand, void> {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  async execute({ workspaceId, runId }: DeleteRunCommand) {
    const run = await this.runs.require(workspaceId, runId);
    if (!isFinished(run.status)) throw new Conflict("The run is still in progress: cancel it first");
    await this.runs.delete(run.id);
  }
}

export class ReplayRunCommand { constructor(readonly workspaceId: string, readonly runId: string, readonly triggeredBy: string, readonly actor: Actor = LOCAL_ACTOR) {} }

/** The same plan, against the same environment, as a new run over the current contract. */
@CommandHandler(ReplayRunCommand)
export class ReplayRunHandler implements ICommandHandler<ReplayRunCommand, { id: string }> {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository, @Inject(CommandBus) private readonly commands: CommandBus) {}

  async execute({ workspaceId, runId, triggeredBy, actor }: ReplayRunCommand) {
    const run = await this.runs.require(workspaceId, runId);
    if (run.kind === "load") requireRole(actor, "admin", "A load test");
    if (run.kind === "load") return this.commands.execute(new StartLoadRunCommand(workspaceId, run.projectId, run.environmentId, run.plan as unknown as LoadPlan, triggeredBy));
    return this.commands.execute(new StartRunCommand(workspaceId, run.projectId, run.environmentId, run.plan as unknown as FunctionalPlan, run.scope, triggeredBy, actor));
  }
}
