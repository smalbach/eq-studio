import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { ProjectFile } from "@eq/runner-core";
import { SpecVersionRepository } from "../../../specs/infrastructure/spec-version.repository.ts";
import { ProjectRepository } from "../../infrastructure/project.repository.ts";
import { ProjectReader } from "../project-reader.ts";

export type ProjectSummary = { id: string; slug: string; name: string; rev: number; activeSpecVersionId: string | null; contractVersion: string | null; operationCount: number; updatedAt: string };

export class ListProjectsQuery { constructor(readonly workspaceId: string) {} }

@QueryHandler(ListProjectsQuery)
export class ListProjectsHandler implements IQueryHandler<ListProjectsQuery, ProjectSummary[]> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository) {}

  async execute({ workspaceId }: ListProjectsQuery) {
    const rows = await this.projects.list(workspaceId);
    return Promise.all(rows.map(async (row) => {
      const version = row.activeSpecVersionId ? await this.versions.require(row.id, row.activeSpecVersionId) : null;
      return { id: row.id, slug: row.slug, name: row.name, rev: row.rev, activeSpecVersionId: row.activeSpecVersionId, contractVersion: version?.version ?? null, operationCount: version?.operationCount ?? 0, updatedAt: row.updatedAt };
    }));
  }
}

export type ProjectDetail = ProjectSummary & { createdAt: string; environments: number; file: ProjectFile };

export class GetProjectQuery { constructor(readonly workspaceId: string, readonly projectId: string) {} }

/** One project with its whole configuration, as a project file plus its bookkeeping. */
@QueryHandler(GetProjectQuery)
export class GetProjectHandler implements IQueryHandler<GetProjectQuery, ProjectDetail> {
  constructor(@Inject(ProjectReader) private readonly reader: ProjectReader) {}

  async execute({ workspaceId, projectId }: GetProjectQuery) {
    const { project, activeVersion, environments, file } = await this.reader.snapshot(workspaceId, projectId);
    return { id: project.id, slug: project.slug, name: project.name, rev: project.rev, activeSpecVersionId: project.activeSpecVersionId, contractVersion: activeVersion?.version ?? null, operationCount: activeVersion?.operationCount ?? 0, createdAt: project.createdAt, updatedAt: project.updatedAt, environments: environments.length, file };
  }
}

export class ExportProjectQuery { constructor(readonly workspaceId: string, readonly projectId: string) {} }

/** The `.eq.json` file: the same format the examples use and the import reads. */
@QueryHandler(ExportProjectQuery)
export class ExportProjectHandler implements IQueryHandler<ExportProjectQuery, ProjectFile> {
  constructor(@Inject(ProjectReader) private readonly reader: ProjectReader) {}

  async execute({ workspaceId, projectId }: ExportProjectQuery) {
    return (await this.reader.snapshot(workspaceId, projectId)).file;
  }
}
