import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { Requires } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { specSource } from "../../shared/inputs.ts";
import { ActivateSpecVersionCommand, ImportSpecVersionCommand } from "../application/commands/spec-commands.ts";
import { GetOperationsQuery, GetSpecDiffQuery, ListSpecVersionsQuery } from "../application/queries/spec-queries.ts";

const importVersion = z.object({ source: specSource, activate: z.boolean().optional() });

@Controller("v1/projects/:project")
export class SpecsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  @Get("spec-versions")
  list(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.queries.execute(new ListSpecVersionsQuery(workspaceId, project));
  }

  @Get(["specs/diff", "spec-versions/diff"])
  diff(@Workspace() workspaceId: string, @Param("project") project: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.queries.execute(new GetSpecDiffQuery(workspaceId, project, from || undefined, to || undefined));
  }

  @Requires("editor")
  @Post("spec-versions")
  import(@Workspace() workspaceId: string, @Param("project") project: string, @Body() body: unknown) {
    const input = parse(importVersion, body);
    return this.commands.execute(new ImportSpecVersionCommand(workspaceId, project, input.source, input.activate ?? true));
  }

  @Requires("editor")
  @Post("spec-versions/:version/activate")
  @HttpCode(204)
  async activate(@Workspace() workspaceId: string, @Param("project") project: string, @Param("version") version: string) {
    await this.commands.execute(new ActivateSpecVersionCommand(workspaceId, project, version));
  }

  @Get("operations")
  operations(@Workspace() workspaceId: string, @Param("project") project: string, @Query("specVersionId") specVersionId?: string) {
    return this.queries.execute(new GetOperationsQuery(workspaceId, project, specVersionId));
  }
}
