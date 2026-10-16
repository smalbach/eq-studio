import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ORDER_MODES } from "@eq/runner-core";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { Requires } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { CONFIG_SECTIONS } from "../../projects/domain/project.ts";
import { GenerateConfigCommand, UpdateConfigSectionCommand } from "../application/commands/config-commands.ts";
import { GetProjectConfigQuery, GetScenariosQuery, PreviewQueueQuery } from "../application/queries/config-queries.ts";

const section = z.enum(CONFIG_SECTIONS);
const updateSection = z.object({ value: z.unknown(), expectedRev: z.number().int().positive().optional() });
const generate = z.object({ mode: z.enum(["merge", "replace"]).default("merge"), expectedRev: z.number().int().positive().optional() });
const flag = z.enum(["true", "false"]).optional().transform((value) => value === "true");
const locale = z.enum(["es", "en"]).default("es");
const scenariosQuery = z.object({ auth: flag, locale });
const queueQuery = z.object({ mode: z.enum(ORDER_MODES as ["contract", "safe", "custom"]).default("safe"), auth: flag, readOnly: flag, locale, endpoints: z.string().optional(), order: z.string().optional() });
const list = (value?: string) => value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;

@Controller("v1/projects/:project")
export class ConfigController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  @Get("config")
  get(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.queries.execute(new GetProjectConfigQuery(workspaceId, project));
  }

  @Requires("editor")
  @Put("config/:section")
  async update(@Workspace() workspaceId: string, @Param("project") project: string, @Param("section") name: string, @Body() body: unknown) {
    const input = parse(updateSection, body);
    return { rev: await this.commands.execute(new UpdateConfigSectionCommand(workspaceId, project, parse(section, name), input.value ?? null, input.expectedRev)) };
  }

  @Requires("editor")
  @Post("config/generate")
  async generate(@Workspace() workspaceId: string, @Param("project") project: string, @Body() body: unknown) {
    const input = parse(generate, body ?? {});
    return { rev: await this.commands.execute(new GenerateConfigCommand(workspaceId, project, input.mode, input.expectedRev)) };
  }

  @Get("scenarios")
  scenarios(@Workspace() workspaceId: string, @Param("project") project: string, @Query() query: unknown) {
    const input = parse(scenariosQuery, query);
    return this.queries.execute(new GetScenariosQuery(workspaceId, project, input.auth, input.locale));
  }

  @Get("queue-preview")
  queue(@Workspace() workspaceId: string, @Param("project") project: string, @Query() query: unknown) {
    const input = parse(queueQuery, query);
    return this.queries.execute(new PreviewQueueQuery(workspaceId, project, { mode: input.mode, customOrder: list(input.order) ?? [], endpointIds: list(input.endpoints), caseSelection: {}, authEnabled: input.auth, locale: input.locale, readOnly: input.readOnly }));
  }
}
