import { Inject, Injectable } from "@nestjs/common";
import { projectFile, type EnvironmentConfig, type ProjectFile } from "@eq/runner-core";
import type { EnvironmentRow, ProjectRow, SpecVersionRow } from "../../../database/entities.ts";
import { EnvironmentRepository } from "../../environments/infrastructure/environment.repository.ts";
import { SpecVersionRepository } from "../../specs/infrastructure/spec-version.repository.ts";
import { assembleConfig } from "../domain/project.ts";
import { ProjectRepository } from "../infrastructure/project.repository.ts";

export function environmentConfig(row: EnvironmentRow): EnvironmentConfig {
  return {
    id: row.key, name: row.name, baseUrl: row.baseUrl,
    ...(row.specUrl ? { specUrl: row.specUrl } : {}),
    ...(row.seeded !== null ? { seeded: row.seeded } : {}),
    ...(row.writesAllowed !== null ? { writesAllowed: row.writesAllowed } : {}),
    ...(row.enforceLatency !== null ? { enforceLatency: row.enforceLatency } : {}),
    ...(row.authEnabled !== null ? { authEnabled: row.authEnabled } : {}),
    ...(row.description ? { description: row.description } : {}),
  };
}

export type ProjectSnapshot = { project: ProjectRow; activeVersion: SpecVersionRow | null; file: ProjectFile; environments: EnvironmentRow[] };

/** The read side of a project: everything about it assembled into a `ProjectFile`. */
@Injectable()
export class ProjectReader {
  constructor(
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
  ) {}

  async snapshot(workspaceId: string, idOrSlug: string): Promise<ProjectSnapshot> {
    const project = await this.projects.require(workspaceId, idOrSlug);
    const activeVersion = project.activeSpecVersionId ? await this.versions.require(project.id, project.activeSpecVersionId) : null;
    const operations = await this.versions.operations(project.activeSpecVersionId);
    const environments = await this.environments.list(project.id);
    const config = assembleConfig(project.name, project.config, operations, activeVersion?.version);
    return { project, activeVersion, environments, file: projectFile(config, environments.map(environmentConfig), project.load ?? undefined) };
  }
}
