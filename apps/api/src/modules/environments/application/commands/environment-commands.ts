import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import type { DataSource } from "typeorm";
import { Conflict } from "../../../../shared/errors.ts";
import { isoNow } from "../../../../shared/ids.ts";
import { DATA_SOURCE } from "../../../../shared/tokens.ts";
import { checkRev } from "../../../projects/application/commands/update-project.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { EnvironmentChanged } from "../../../shared/events.ts";
import type { EnvironmentInput } from "../../../shared/inputs.ts";
import { EnvironmentRepository } from "../../infrastructure/environment.repository.ts";
import { CredentialRepository } from "../../../credentials/infrastructure/credential.repository.ts";
import { newEnvironment } from "../environment-row.ts";

export class CreateEnvironmentCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly input: EnvironmentInput) {} }

/** Where a project runs. It holds no secret: credentials never live in an environment. */
@CommandHandler(CreateEnvironmentCommand)
export class CreateEnvironmentHandler implements ICommandHandler<CreateEnvironmentCommand, { id: string; key: string }> {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource, @Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, input }: CreateEnvironmentCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const row = await this.db.transaction(async (tx) => {
      if (input.key && await this.environments.keyTaken(project.id, input.key, tx)) throw new Conflict(`The project already has an environment ${input.key}`);
      const created = await newEnvironment(this.environments, workspaceId, project.id, input, tx);
      await this.environments.save(created, tx);
      return created;
    });
    this.events.publish(new EnvironmentChanged(workspaceId, project.id, row.id, "created"));
    return { id: row.id, key: row.key };
  }
}

export class UpdateEnvironmentCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly changes: Partial<Omit<EnvironmentInput, "key">>, readonly expectedRev?: number) {} }

/** Changes only the fields sent; `null` clears an optional one. */
@CommandHandler(UpdateEnvironmentCommand)
export class UpdateEnvironmentHandler implements ICommandHandler<UpdateEnvironmentCommand, number> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, environmentId, changes, expectedRev }: UpdateEnvironmentCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const row = await this.environments.require(project.id, environmentId);
    checkRev(row.rev, expectedRev);
    const nullable = (value: unknown) => value === undefined ? undefined : value ?? null;
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.baseUrl !== undefined) row.baseUrl = changes.baseUrl.replace(/\/+$/, "");
    for (const [key, field] of [["specUrl", "specUrl"], ["seeded", "seeded"], ["writesAllowed", "writesAllowed"], ["enforceLatency", "enforceLatency"], ["authEnabled", "authEnabled"], ["description", "description"]] as const) {
      const value = nullable(changes[key]);
      if (value !== undefined) (row as Record<string, unknown>)[field] = value;
    }
    row.rev += 1;
    row.updatedAt = isoNow();
    await this.environments.save(row);
    this.events.publish(new EnvironmentChanged(workspaceId, project.id, row.id, "updated"));
    return row.rev;
  }
}

export class DeleteEnvironmentCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string) {} }

/** A soft delete; the key is released so another environment can take it. Its credentials are
 * deleted for good: a secret does not linger behind an environment nobody can see. */
@CommandHandler(DeleteEnvironmentCommand)
export class DeleteEnvironmentHandler implements ICommandHandler<DeleteEnvironmentCommand, void> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(CredentialRepository) private readonly credentials: CredentialRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, environmentId }: DeleteEnvironmentCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const row = await this.environments.require(project.id, environmentId);
    const now = isoNow();
    row.key = `${row.key}~${row.id.slice(-12)}`.slice(0, 120);
    row.deletedAt = now;
    row.updatedAt = now;
    row.rev += 1;
    await this.environments.save(row);
    await this.credentials.deleteAll(row.id);
    this.events.publish(new EnvironmentChanged(workspaceId, project.id, row.id, "deleted"));
  }
}
