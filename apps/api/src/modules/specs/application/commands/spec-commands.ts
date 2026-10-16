import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import { isoNow } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { SpecVersionActivated, SpecVersionImported } from "../../../shared/events.ts";
import { SpecVersionRepository } from "../../infrastructure/spec-version.repository.ts";
import { SpecImporter, type SpecSource } from "../spec-importer.ts";

export class ImportSpecVersionCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly source: SpecSource, readonly activate = true) {} }
export type ImportSpecVersionResult = { id: string; created: boolean; active: boolean; operationCount: number; warnings: string[] };

/**
 * A new snapshot of the contract. The document is read before the transaction opens; the same
 * content imported twice is the same version. Activating it changes which operations the
 * project's matrix is generated from — its configuration is left as it is.
 */
@CommandHandler(ImportSpecVersionCommand)
export class ImportSpecVersionHandler implements ICommandHandler<ImportSpecVersionCommand, ImportSpecVersionResult> {
  constructor(
    @Inject(DATA_SOURCE) private readonly db: DataSource,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(SpecImporter) private readonly importer: SpecImporter,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async execute({ workspaceId, projectId, source, activate }: ImportSpecVersionCommand) {
    await this.projects.require(workspaceId, projectId);
    const { parsed, url } = await this.importer.read(source);
    const published: object[] = [];
    const result = await this.db.transaction(async (tx) => {
      const project = await this.projects.require(workspaceId, projectId, tx);
      const { version, created } = await this.importer.store(project, parsed, url, tx);
      published.push(new SpecVersionImported(workspaceId, project.id, version.id, created));
      if (activate && project.activeSpecVersionId !== version.id) {
        project.activeSpecVersionId = version.id;
        project.rev += 1;
        project.updatedAt = isoNow();
        await this.projects.save(project, tx);
        published.push(new SpecVersionActivated(workspaceId, project.id, version.id));
      }
      return { id: version.id, created, active: project.activeSpecVersionId === version.id, operationCount: version.operationCount, warnings: parsed.warnings };
    });
    this.events.publishAll(published);
    return result;
  }
}

export class ActivateSpecVersionCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly specVersionId: string) {} }

/** Points the project at an earlier (or later) snapshot — a rollback is one call. */
@CommandHandler(ActivateSpecVersionCommand)
export class ActivateSpecVersionHandler implements ICommandHandler<ActivateSpecVersionCommand, void> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, specVersionId }: ActivateSpecVersionCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const version = await this.versions.require(project.id, specVersionId);
    if (project.activeSpecVersionId === version.id) return;
    project.activeSpecVersionId = version.id;
    project.rev += 1;
    project.updatedAt = isoNow();
    await this.projects.save(project);
    this.events.publish(new SpecVersionActivated(workspaceId, project.id, version.id));
  }
}
