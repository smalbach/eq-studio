import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { RunKind } from "../../../../database/entities.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { RunRepository } from "../../infrastructure/run.repository.ts";

export class ListRunsQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly kind?: RunKind, readonly limit = 50, readonly full = false) {} }

@QueryHandler(ListRunsQuery)
export class ListRunsHandler implements IQueryHandler<ListRunsQuery> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(RunRepository) private readonly runs: RunRepository) {}

  /** With `full`, each run also carries its cases and their steps — what the trend, flaky-case
   * and comparison views read — so the history is one request, not one per run. */
  async execute({ workspaceId, projectId, kind, limit, full }: ListRunsQuery) {
    const project = await this.projects.require(workspaceId, projectId);
    const runs = await this.runs.list(project.id, kind, Math.min(200, Math.max(1, limit)), full);
    if (!full) return runs;
    return Promise.all(runs.map(async (run) => ({ ...run, cases: run.kind === "functional" ? await this.runs.casesOf(run.id, true) : [] })));
  }
}

export class GetRunQuery { constructor(readonly workspaceId: string, readonly runId: string, readonly withSteps = false) {} }

/** A run with its cases; the steps of each case only when asked for. */
@QueryHandler(GetRunQuery)
export class GetRunHandler implements IQueryHandler<GetRunQuery> {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  async execute({ workspaceId, runId, withSteps }: GetRunQuery) {
    const run = await this.runs.require(workspaceId, runId);
    return { ...run, cases: await this.runs.casesOf(run.id, withSteps) };
  }
}
