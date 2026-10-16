import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { environmentConfig } from "../../../projects/application/project-reader.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { EnvironmentRepository } from "../../infrastructure/environment.repository.ts";

export class ListEnvironmentsQuery { constructor(readonly workspaceId: string, readonly projectId: string) {} }

@QueryHandler(ListEnvironmentsQuery)
export class ListEnvironmentsHandler implements IQueryHandler<ListEnvironmentsQuery> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository) {}

  async execute({ workspaceId, projectId }: ListEnvironmentsQuery) {
    const project = await this.projects.require(workspaceId, projectId);
    const rows = await this.environments.list(project.id);
    return rows.map((row) => ({ ...environmentConfig(row), environmentId: row.id, rev: row.rev, updatedAt: row.updatedAt }));
  }
}
