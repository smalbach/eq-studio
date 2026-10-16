import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { CurrentActor, Requires, type Actor } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { parse } from "../../../shared/zod.ts";
import { GetKeyCheckQuery, ListConflictsQuery, PullChangesQuery, PushChangesCommand, ResolveConflictCommand, SetKeyCheckCommand } from "../application/sync-server.ts";
import { SYNC_ORDER, type SyncType } from "../domain/merge.ts";

const snapshot = z.record(z.string(), z.unknown());
const push = z.object({
  deviceId: z.string().max(64).optional(),
  device: z.string().max(200).optional(),
  items: z.array(z.object({ type: z.enum(SYNC_ORDER as [SyncType, ...SyncType[]]), id: z.string().min(1).max(120), baseRev: z.number().int().nullable().optional(), base: snapshot.nullable().optional(), data: snapshot })).max(200),
  resolved: z.array(z.string().max(64)).max(1000).default([]),
});
const pull = z.object({ since: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100) });
const resolve = z.object({ choice: z.enum(["mine", "theirs"]) });
const keycheck = z.object({ salt: z.string().max(100), sealed: z.string().max(1000) });

/**
 * The cloud's sync endpoints, for linked devices. A pull needs a viewer; a push is checked
 * entity by entity, with the role that change would need through the rest of the API.
 */
@Controller("v1/sync")
export class SyncServerController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  @Get("changes")
  changes(@CurrentActor() actor: Actor, @Query() query: unknown) {
    const { since, limit } = parse(pull, query);
    return this.queries.execute(new PullChangesQuery(actor, since, limit));
  }

  @Requires("viewer")
  @Post("changes")
  @HttpCode(200)
  push(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = parse(push, body);
    return this.commands.execute(new PushChangesCommand(actor, input.device ?? "device", input.items, input.resolved));
  }

  @Get("conflicts")
  conflicts(@Workspace() workspaceId: string) {
    return this.queries.execute(new ListConflictsQuery(workspaceId));
  }

  @Requires("editor")
  @Post("conflicts/:id/resolve")
  @HttpCode(204)
  async resolve(@CurrentActor() actor: Actor, @Param("id") id: string, @Body() body: unknown) {
    await this.commands.execute(new ResolveConflictCommand(actor, id, parse(resolve, body).choice));
  }

  @Get("keycheck")
  keycheck(@Workspace() workspaceId: string) {
    return this.queries.execute(new GetKeyCheckQuery(workspaceId));
  }

  @Requires("admin")
  @Put("keycheck")
  @HttpCode(204)
  async setKeycheck(@CurrentActor() actor: Actor, @Body() body: unknown) {
    await this.commands.execute(new SetKeyCheckCommand(actor, parse(keycheck, body)));
  }
}
