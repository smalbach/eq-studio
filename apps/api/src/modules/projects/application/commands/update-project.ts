import { Inject } from "@nestjs/common";
import { CommandHandler, EventBus, type ICommandHandler } from "@nestjs/cqrs";
import { Conflict } from "../../../../shared/errors.ts";
import { isoNow } from "../../../../shared/ids.ts";
import { ProjectArchived, ProjectUpdated } from "../../../shared/events.ts";
import { slugify } from "../../domain/project.ts";
import { ProjectRepository } from "../../infrastructure/project.repository.ts";

/** Fails with 409 when the project changed since the client read it: no silent overwrite. */
export function checkRev(current: number, expected: number | undefined) {
  if (expected !== undefined && expected !== current) throw new Conflict(`The project changed since it was read (rev ${current}, expected ${expected}): read it again and retry`);
}

export class UpdateProjectCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly changes: { name?: string; slug?: string }, readonly expectedRev?: number) {} }

@CommandHandler(UpdateProjectCommand)
export class UpdateProjectHandler implements ICommandHandler<UpdateProjectCommand, number> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId, changes, expectedRev }: UpdateProjectCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    checkRev(project.rev, expectedRev);
    if (changes.slug !== undefined) {
      const slug = slugify(changes.slug);
      if (slug !== project.slug && await this.projects.slugTaken(workspaceId, slug)) throw new Conflict(`The slug ${slug} is taken`);
      project.slug = slug;
    }
    if (changes.name !== undefined) project.name = changes.name;
    project.rev += 1;
    project.updatedAt = isoNow();
    await this.projects.save(project);
    this.events.publish(new ProjectUpdated(workspaceId, project.id, project.rev));
    return project.rev;
  }
}

export class ArchiveProjectCommand { constructor(readonly workspaceId: string, readonly projectId: string) {} }

/** A soft delete. The slug is released so a new project can take it. */
@CommandHandler(ArchiveProjectCommand)
export class ArchiveProjectHandler implements ICommandHandler<ArchiveProjectCommand, void> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EventBus) private readonly events: EventBus) {}

  async execute({ workspaceId, projectId }: ArchiveProjectCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const now = isoNow();
    project.slug = `${project.slug}~${project.id.slice(-12)}`.slice(0, 120);
    project.deletedAt = now;
    project.updatedAt = now;
    project.rev += 1;
    await this.projects.save(project);
    this.events.publish(new ProjectArchived(workspaceId, project.id));
  }
}
