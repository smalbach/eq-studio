import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { CurrentActor, Requires, ROLES, type Actor } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { parse } from "../../../shared/zod.ts";
import { CancelInvitationCommand, ChangeRoleCommand, InviteMemberCommand, IssueApiTokenCommand, RemoveMemberCommand, RevokeApiTokenCommand } from "../application/accounts-commands.ts";
import { ApiTokensQuery, CurrentWorkspaceQuery, InvitationsQuery, MembersQuery } from "../application/accounts-queries.ts";

const role = z.enum(ROLES as ["viewer", "editor", "admin", "owner"]);
const invite = z.object({ email: z.email(), role });
const changeRole = z.object({ role });
const apiToken = z.object({ name: z.string().min(1).max(200), role: role.default("editor"), expiresInDays: z.number().int().min(1).max(3650).optional() });

/** The workspace the request acts in: its members, invitations and API tokens. */
@Controller("v1/workspace")
export class WorkspaceController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  @Get()
  current(@CurrentActor() actor: Actor) {
    return this.queries.execute(new CurrentWorkspaceQuery(actor));
  }

  @Get("members")
  members(@Workspace() workspaceId: string) {
    return this.queries.execute(new MembersQuery(workspaceId));
  }

  @Requires("owner")
  @Patch("members/:user")
  @HttpCode(204)
  async changeRole(@CurrentActor() actor: Actor, @Param("user") user: string, @Body() body: unknown) {
    await this.commands.execute(new ChangeRoleCommand(actor, user, parse(changeRole, body).role));
  }

  @Requires("admin")
  @Delete("members/:user")
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param("user") user: string) {
    await this.commands.execute(new RemoveMemberCommand(actor, user));
  }

  @Requires("admin")
  @Get("invitations")
  invitations(@Workspace() workspaceId: string) {
    return this.queries.execute(new InvitationsQuery(workspaceId));
  }

  @Requires("admin")
  @Post("invitations")
  invite(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = parse(invite, body);
    return this.commands.execute(new InviteMemberCommand(actor, input.email, input.role));
  }

  @Requires("admin")
  @Delete("invitations/:id")
  @HttpCode(204)
  async cancelInvitation(@Workspace() workspaceId: string, @Param("id") id: string) {
    await this.commands.execute(new CancelInvitationCommand(workspaceId, id));
  }

  @Requires("admin")
  @Get("api-tokens")
  tokens(@Workspace() workspaceId: string) {
    return this.queries.execute(new ApiTokensQuery(workspaceId));
  }

  @Requires("admin")
  @Post("api-tokens")
  issue(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const input = parse(apiToken, body);
    return this.commands.execute(new IssueApiTokenCommand(actor, input.name, input.role, input.expiresInDays));
  }

  @Requires("admin")
  @Delete("api-tokens/:id")
  @HttpCode(204)
  async revoke(@CurrentActor() actor: Actor, @Param("id") id: string) {
    await this.commands.execute(new RevokeApiTokenCommand(actor, id));
  }
}
