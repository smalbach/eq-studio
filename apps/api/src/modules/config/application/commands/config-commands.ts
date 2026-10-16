import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import { projectFromOpenApi } from "@eq/runner-core";
import { Invalid } from "../../../../shared/errors.ts";
import { isoNow } from "../../../../shared/ids.ts";
import { checkRev } from "../../../projects/application/commands/update-project.ts";
import { applySection, assembleConfig, assertValid, storedPart, type ConfigSection } from "../../../projects/domain/project.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { ProjectConfigChanged } from "../../../shared/events.ts";
import { SpecVersionRepository } from "../../../specs/infrastructure/spec-version.repository.ts";
import { mergeGenerated } from "../../domain/merge.ts";

export class UpdateConfigSectionCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly section: ConfigSection, readonly value: unknown, readonly expectedRev?: number) {} }

/**
 * Replaces one section of the configuration. The whole configuration is validated against the
 * active contract before it is stored: a body for an operation that does not exist is a 422
 * now, not a confusing case later.
 */
@CommandHandler(UpdateConfigSectionCommand)
export class UpdateConfigSectionHandler implements ICommandHandler<UpdateConfigSectionCommand, number> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, section, value, expectedRev }: UpdateConfigSectionCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    checkRev(project.rev, expectedRev);
    const { stored, load } = applySection(project.config, project.load, section, value);
    assertValid(assembleConfig(project.name, stored, await this.versions.operations(project.activeSpecVersionId)));
    project.config = stored;
    project.load = load;
    project.rev += 1;
    project.updatedAt = isoNow();
    await this.projects.save(project);
    this.events.publish(new ProjectConfigChanged(workspaceId, project.id, [section], project.rev));
    return project.rev;
  }
}

export class GenerateConfigCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly mode: "merge" | "replace", readonly expectedRev?: number) {} }

/** The configuration the active contract suggests, merged into or replacing the current one. */
@CommandHandler(GenerateConfigCommand)
export class GenerateConfigHandler implements ICommandHandler<GenerateConfigCommand, number> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, mode, expectedRev }: GenerateConfigCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    checkRev(project.rev, expectedRev);
    if (!project.activeSpecVersionId) throw new Invalid("The project has no contract yet: import an OpenAPI document first");
    const version = await this.versions.require(project.id, project.activeSpecVersionId);
    if (!version.document) throw new Invalid("The active version came from a project file and has no OpenAPI document to generate from");
    const generated = storedPart(projectFromOpenApi(JSON.parse(version.document), { name: project.name }).config);
    const stored = mergeGenerated(project.config, generated, mode);
    assertValid(assembleConfig(project.name, stored, await this.versions.operations(version.id)));
    project.config = stored;
    project.rev += 1;
    project.updatedAt = isoNow();
    await this.projects.save(project);
    this.events.publish(new ProjectConfigChanged(workspaceId, project.id, Object.keys(generated), project.rev));
    return project.rev;
  }
}
