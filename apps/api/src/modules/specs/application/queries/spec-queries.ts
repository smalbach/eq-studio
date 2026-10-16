import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { ProjectOperation } from "@eq/runner-core";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { SpecVersionRepository } from "../../infrastructure/spec-version.repository.ts";
import { SpecDiffer, type SpecVersionDiff } from "../spec-differ.ts";

export class ListSpecVersionsQuery { constructor(readonly workspaceId: string, readonly projectId: string) {} }

@QueryHandler(ListSpecVersionsQuery)
export class ListSpecVersionsHandler implements IQueryHandler<ListSpecVersionsQuery> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository) {}

  async execute({ workspaceId, projectId }: ListSpecVersionsQuery) {
    const project = await this.projects.require(workspaceId, projectId);
    const rows = await this.versions.list(project.id);
    return rows.map((row) => ({ ...row, active: row.id === project.activeSpecVersionId }));
  }
}

export class GetOperationsQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly specVersionId?: string) {} }

/** The operations of the active version, or of the one asked for. */
@QueryHandler(GetOperationsQuery)
export class GetOperationsHandler implements IQueryHandler<GetOperationsQuery, ProjectOperation[]> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository) {}

  async execute({ workspaceId, projectId, specVersionId }: GetOperationsQuery) {
    const project = await this.projects.require(workspaceId, projectId);
    const id = specVersionId ? (await this.versions.require(project.id, specVersionId)).id : project.activeSpecVersionId;
    return this.versions.operations(id);
  }
}

export class GetSpecDiffQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly from?: string, readonly to?: string) {} }

/** What changed between two versions; by default, from the one before the active version to the active one. */
@QueryHandler(GetSpecDiffQuery)
export class GetSpecDiffHandler implements IQueryHandler<GetSpecDiffQuery, SpecVersionDiff> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecDiffer) private readonly differ: SpecDiffer) {}

  async execute({ workspaceId, projectId, from, to }: GetSpecDiffQuery) {
    return this.differ.forProject(await this.projects.require(workspaceId, projectId), from, to);
  }
}
