import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { Requires } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { environmentInput } from "../../shared/inputs.ts";
import { CreateEnvironmentCommand, DeleteEnvironmentCommand, UpdateEnvironmentCommand } from "../application/commands/environment-commands.ts";
import { ListEnvironmentsQuery } from "../application/queries/list-environments.ts";

const fields = environmentInput.omit({ key: true }).partial().shape;
const updateEnvironment = z.object({
  ...fields,
  specUrl: fields.specUrl.nullable(), seeded: fields.seeded.nullable(), writesAllowed: fields.writesAllowed.nullable(), enforceLatency: fields.enforceLatency.nullable(), authEnabled: fields.authEnabled.nullable(), description: fields.description.nullable(),
  expectedRev: z.number().int().positive().optional(),
});

@Controller("v1/projects/:project/environments")
export class EnvironmentsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  @Get()
  list(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.queries.execute(new ListEnvironmentsQuery(workspaceId, project));
  }

  @Requires("admin")
  @Post()
  create(@Workspace() workspaceId: string, @Param("project") project: string, @Body() body: unknown) {
    return this.commands.execute(new CreateEnvironmentCommand(workspaceId, project, parse(environmentInput, body)));
  }

  @Requires("admin")
  @Patch(":environment")
  async update(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string, @Body() body: unknown) {
    const { expectedRev, ...changes } = parse(updateEnvironment, body);
    return { rev: await this.commands.execute(new UpdateEnvironmentCommand(workspaceId, project, environment, changes as never, expectedRev)) };
  }

  @Requires("admin")
  @Delete(":environment")
  @HttpCode(204)
  async remove(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string) {
    await this.commands.execute(new DeleteEnvironmentCommand(workspaceId, project, environment));
  }
}
