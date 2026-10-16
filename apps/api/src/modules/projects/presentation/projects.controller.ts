import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { CurrentActor, Requires, type Actor } from "../../../shared/rbac.ts";
import { AuditLog } from "../../audit/audit-log.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { environmentInput, specSource } from "../../shared/inputs.ts";
import { CreateProjectCommand } from "../application/commands/create-project.ts";
import { ImportProjectFileCommand } from "../application/commands/import-project-file.ts";
import { ArchiveProjectCommand, UpdateProjectCommand } from "../application/commands/update-project.ts";
import { ExportProjectQuery, GetProjectQuery, ListProjectsQuery } from "../application/queries/project-queries.ts";

const slug = z.string().min(1).max(80);
const createProject = z.object({ name: z.string().min(1).max(200).optional(), slug: slug.optional(), spec: specSource.optional(), generateConfig: z.boolean().optional(), environments: z.array(environmentInput).max(20).optional() }).refine((value) => value.name || value.spec, { message: "a name or a spec is required" });
const updateProject = z.object({ name: z.string().min(1).max(200).optional(), slug: slug.optional(), expectedRev: z.number().int().positive().optional() });
const importProject = z.object({ file: z.unknown(), slug: slug.optional() });

/** Controllers validate, resolve the workspace and dispatch. No logic lives here. */
@Controller("v1/projects")
export class ProjectsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus, @Inject(AuditLog) private readonly audit: AuditLog) {}

  @Get()
  list(@Workspace() workspaceId: string) {
    return this.queries.execute(new ListProjectsQuery(workspaceId));
  }

  @Requires("editor")
  @Post()
  create(@Workspace() workspaceId: string, @Body() body: unknown) {
    return this.commands.execute(new CreateProjectCommand(workspaceId, parse(createProject, body)));
  }

  @Requires("editor")
  @Post("import")
  import(@Workspace() workspaceId: string, @Body() body: unknown) {
    const input = parse(importProject, body);
    return this.commands.execute(new ImportProjectFileCommand(workspaceId, input.file, input.slug));
  }

  @Get(":project")
  get(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.queries.execute(new GetProjectQuery(workspaceId, project));
  }

  @Requires("editor")
  @Patch(":project")
  async update(@Workspace() workspaceId: string, @Param("project") project: string, @Body() body: unknown) {
    const { expectedRev, ...changes } = parse(updateProject, body);
    return { rev: await this.commands.execute(new UpdateProjectCommand(workspaceId, project, changes, expectedRev)) };
  }

  @Requires("admin")
  @Delete(":project")
  @HttpCode(204)
  async archive(@CurrentActor() actor: Actor, @Workspace() workspaceId: string, @Param("project") project: string) {
    await this.commands.execute(new ArchiveProjectCommand(workspaceId, project));
    await this.audit.record({ workspaceId, type: "project.deleted", actor, target: { type: "project", id: project, label: project } });
  }

  @Get(":project/export")
  export(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.queries.execute(new ExportProjectQuery(workspaceId, project));
  }
}
