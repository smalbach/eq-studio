import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import { projectFromOpenApi, type ContractFormat } from "@eq/runner-core";
import type { ProjectRow } from "../../../../database/entities.ts";
import { isoNow, uuidv7 } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { EnvironmentRepository } from "../../../environments/infrastructure/environment.repository.ts";
import { newEnvironment } from "../../../environments/application/environment-row.ts";
import { EnvironmentChanged, ProjectCreated, SpecVersionActivated, SpecVersionImported } from "../../../shared/events.ts";
import type { EnvironmentInput } from "../../../shared/inputs.ts";
import { SpecImporter, type SpecSource } from "../../../specs/application/spec-importer.ts";
import { slugify, storedPart } from "../../domain/project.ts";
import { ProjectRepository } from "../../infrastructure/project.repository.ts";

export type CreateProjectInput = { name?: string; slug?: string; spec?: SpecSource; generateConfig?: boolean; environments?: EnvironmentInput[] };
export class CreateProjectCommand { constructor(readonly workspaceId: string, readonly input: CreateProjectInput) {} }
/** `sourceFormat` and `baseUrl` say what the contract was and where it says the API runs, for the first environment. */
export type CreateProjectResult = { id: string; slug: string; specVersionId: string | null; warnings: string[]; sourceFormat: ContractFormat | null; baseUrl: string | null };

/**
 * A project, optionally from its contract in one step: the document is read **before** anything
 * is written, so an unreachable URL leaves nothing half-created. With a contract the generated
 * configuration is stored too, unless `generateConfig` is false.
 */
@CommandHandler(CreateProjectCommand)
export class CreateProjectHandler implements ICommandHandler<CreateProjectCommand, CreateProjectResult> {
  constructor(
    @Inject(DATA_SOURCE) private readonly db: DataSource,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
    @Inject(SpecImporter) private readonly importer: SpecImporter,
    @Inject(EventBus) private readonly events: EventBus,
  ) {}

  async execute({ workspaceId, input }: CreateProjectCommand): Promise<CreateProjectResult> {
    const spec = input.spec ? await this.importer.read(input.spec) : null;
    const name = input.name ?? spec?.parsed.title ?? "API";
    const generated = spec && input.generateConfig !== false ? storedPart(projectFromOpenApi(spec.parsed.document, { name }).config) : {};
    const published: object[] = [];
    const result = await this.db.transaction(async (tx) => {
      const base = slugify(input.slug ?? name);
      let slug = base;
      for (let index = 2; await this.projects.slugTaken(workspaceId, slug, tx); index += 1) slug = `${base}-${index}`;
      const now = isoNow();
      const project: ProjectRow = { id: uuidv7(), workspaceId, slug, name, config: generated, load: null, activeSpecVersionId: null, rev: 1, createdAt: now, updatedAt: now, deletedAt: null };
      await this.projects.save(project, tx);
      published.push(new ProjectCreated(workspaceId, project.id));
      if (spec) {
        const { version, created } = await this.importer.store(project, spec.parsed, spec.url, tx);
        project.activeSpecVersionId = version.id;
        await this.projects.save(project, tx);
        published.push(new SpecVersionImported(workspaceId, project.id, version.id, created), new SpecVersionActivated(workspaceId, project.id, version.id));
      }
      for (const environment of input.environments ?? []) {
        const row = await newEnvironment(this.environments, workspaceId, project.id, environment, tx);
        await this.environments.save(row, tx);
        published.push(new EnvironmentChanged(workspaceId, project.id, row.id, "created"));
      }
      return { id: project.id, slug, specVersionId: project.activeSpecVersionId, warnings: spec?.parsed.warnings ?? [], sourceFormat: spec?.parsed.sourceFormat ?? null, baseUrl: spec?.parsed.baseUrl ?? null };
    });
    // Published after the commit: a subscriber never sees an event whose rows were rolled back.
    this.events.publishAll(published);
    return result;
  }
}
