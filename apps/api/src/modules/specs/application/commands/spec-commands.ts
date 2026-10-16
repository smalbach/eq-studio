import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import type { ContractFormat, SpecDiffSummary } from "@eq/runner-core";
import type { SpecVersionRow } from "../../../../database/entities.ts";
import { isoNow } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { SpecVersionActivated, SpecVersionImported } from "../../../shared/events.ts";
import { SpecVersionRepository } from "../../infrastructure/spec-version.repository.ts";
import { SpecDiffer } from "../spec-differ.ts";
import { SpecImporter, type SpecSource } from "../spec-importer.ts";

export class ImportSpecVersionCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly source: SpecSource, readonly activate = true) {} }
/** `diff`: what changed from the version that was active before, for a version this import created. */
export type ImportSpecVersionResult = { id: string; created: boolean; active: boolean; operationCount: number; warnings: string[]; sourceFormat: ContractFormat; diff: { from: string; summary: SpecDiffSummary } | null };

/**
 * A new snapshot of the contract. The document is read before the transaction opens; the same
 * content imported twice is the same version. Activating it changes which operations the
 * project's matrix is generated from — its configuration is left as it is.
 *
 * A new version comes back with its changes against the version that was active, counted as
 * breaking or not, so whoever imports it learns right away whether clients would notice.
 */
@CommandHandler(ImportSpecVersionCommand)
export class ImportSpecVersionHandler implements ICommandHandler<ImportSpecVersionCommand, ImportSpecVersionResult> {
  constructor(
    @Inject(DATA_SOURCE) private readonly db: DataSource,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(SpecImporter) private readonly importer: SpecImporter,
    @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository,
    @Inject(SpecDiffer) private readonly differ: SpecDiffer,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async execute({ workspaceId, projectId, source, activate }: ImportSpecVersionCommand): Promise<ImportSpecVersionResult> {
    const previousId = (await this.projects.require(workspaceId, projectId)).activeSpecVersionId;
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
      return { version, result: { id: version.id, created, active: project.activeSpecVersionId === version.id, operationCount: version.operationCount, warnings: parsed.warnings, sourceFormat: parsed.sourceFormat } };
    });
    this.events.publishAll(published);
    return { ...result.result, diff: result.result.created && previousId && previousId !== result.version.id ? await this.summary(previousId, result.version) : null };
  }

  /** A diff that cannot be made does not undo an import that worked. */
  private async summary(previousId: string, version: SpecVersionRow) {
    try {
      const previous = await this.versions.require(version.projectId, previousId);
      return { from: previous.id, summary: (await this.differ.between(previous, version)).summary };
    } catch {
      return null;
    }
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
