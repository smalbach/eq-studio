import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { runnableScenarios } from "@eq/runner-core";
import { NotFound } from "../../../../shared/errors.ts";
import { RunContextLoader } from "../run-context.ts";
import { RunExecutor } from "../run-executor.ts";
import { LOCAL_ACTOR, requireRole, type Actor } from "../../../../shared/rbac.ts";

export type ProbeInput = { environment: string; operationId: string; scenarioId: string; parameters?: Record<string, string>; body?: unknown; samples: number; locale: "es" | "en" };

export class ProbeCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly input: ProbeInput, readonly actor: Actor = LOCAL_ACTOR) {} }

/**
 * One case, now, with the values a person typed — the workbench's "run this case". Its chained
 * flow runs whole (setup, case, cleanup) and the write guard applies, but nothing is stored: a
 * probe is a question, not evidence. Runs are what get saved.
 */
@CommandHandler(ProbeCommand)
export class ProbeHandler implements ICommandHandler<ProbeCommand> {
  constructor(@Inject(RunContextLoader) private readonly contexts: RunContextLoader, @Inject(RunExecutor) private readonly executor: RunExecutor) {}

  async execute({ workspaceId, projectId, input, actor }: ProbeCommand) {
    const context = await this.contexts.load(workspaceId, projectId, input.environment);
    const endpoint = context.endpoints.find((item) => item.id === input.operationId);
    if (!endpoint) throw new NotFound(`Operation ${input.operationId}`);
    const scenario = runnableScenarios(endpoint, context.config, true, input.locale).find((item) => item.id === input.scenarioId);
    if (!scenario) throw new NotFound(`Case ${input.scenarioId} of ${input.operationId}`);
    // A probe of a write, or of a read whose flow sets itself up with a write, can change data.
    if ((endpoint.method !== "GET" || scenario.flow !== "request") && context.settings.writesAllowed) requireRole(actor, "admin", "Probing a case that writes");
    const runner = await this.executor.scenarioRunner(context, input.locale, input.samples, input.body);
    return runner.runScenario(endpoint, scenario, { ...(scenario.parameters ?? {}), ...(input.parameters ?? {}) }, input.body !== undefined);
  }
}
