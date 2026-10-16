import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import { parseProjectFile } from "@eq/runner-core";
import type { ProjectRow } from "../../../../database/entities.ts";
import { Invalid } from "../../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { EnvironmentRepository } from "../../../environments/infrastructure/environment.repository.ts";
import { newEnvironment } from "../../../environments/application/environment-row.ts";
import { EnvironmentChanged, ProjectCreated, SpecVersionActivated, SpecVersionImported } from "../../../shared/events.ts";
import { SpecImporter } from "../../../specs/application/spec-importer.ts";
import { slugify, storedPart } from "../../domain/project.ts";
import { ProjectRepository } from "../../infrastructure/project.repository.ts";

export class ImportProjectFileCommand { constructor(readonly workspaceId: string, readonly file: unknown, readonly slug?: string) {} }

/** A `.eq.json` file — an example, an export from another machine — as a new project. */
@CommandHandler(ImportProjectFileCommand)
export class ImportProjectFileHandler implements ICommandHandler<ImportProjectFileCommand, { id: string; slug: string }> {
  constructor(
    @Inject(DATA_SOURCE) private readonly db: DataSource,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
    @Inject(SpecImporter) private readonly importer: SpecImporter,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async execute({ workspaceId, file: input, slug: wanted }: ImportProjectFileCommand) {
    let file;
    try { file = parseProjectFile(input); } catch (error) { throw new Invalid("The project file is not valid", String(error instanceof Error ? error.message : error).split("\n")); }
    const published: object[] = [];
    const result = await this.db.transaction(async (tx) => {
      const base = slugify(wanted ?? file.project.name);
      let slug = base;
      for (let index = 2; await this.projects.slugTaken(workspaceId, slug, tx); index += 1) slug = `${base}-${index}`;
      const now = isoNow();
      const project: ProjectRow = { id: uuidv7(), workspaceId, slug, name: file.project.name, config: storedPart(file.project), load: file.load ?? null, activeSpecVersionId: null, rev: 1, createdAt: now, updatedAt: now, deletedAt: null };
      await this.projects.save(project, tx);
      const { version, created } = await this.importer.storeOperations(project, file.project.operations, file.project.contractVersion ?? null, tx);
      project.activeSpecVersionId = version.id;
      await this.projects.save(project, tx);
      published.push(new ProjectCreated(workspaceId, project.id), new SpecVersionImported(workspaceId, project.id, version.id, created), new SpecVersionActivated(workspaceId, project.id, version.id));
      for (const environment of file.environments) {
        const row = await newEnvironment(this.environments, workspaceId, project.id, { key: environment.id, name: environment.name, baseUrl: environment.baseUrl, specUrl: environment.specUrl, seeded: environment.seeded, writesAllowed: environment.writesAllowed, enforceLatency: environment.enforceLatency, authEnabled: environment.authEnabled, description: environment.description }, tx);
        await this.environments.save(row, tx);
        published.push(new EnvironmentChanged(workspaceId, project.id, row.id, "created"));
      }
      return { id: project.id, slug };
    });
    this.events.publishAll(published);
    return result;
  }
}
