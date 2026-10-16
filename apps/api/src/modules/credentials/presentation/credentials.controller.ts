import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { CurrentActor, Requires, type Actor } from "../../../shared/rbac.ts";
import { AuditLog } from "../../audit/audit-log.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { DeleteCredentialCommand, SetCredentialCommand } from "../application/commands/credential-commands.ts";
import { ListCredentialsQuery } from "../application/queries/list-credentials.ts";

const role = z.enum(["primary", "insufficient", "alternate"]);
const optional = z.string().max(2000).nullable().optional();
const credential = z.object({ kind: z.enum(["bearer", "api_key", "basic", "oauth2_client_credentials"]), secret: z.string().max(8000).optional(), headerName: z.string().max(200).regex(/^[A-Za-z0-9-]+$/, "a header name").nullable().optional(), username: optional, tokenUrl: z.url({ protocol: /^https?$/ }).nullable().optional(), clientId: optional, scope: optional });

@Controller("v1/projects/:project/environments/:environment/credentials")
export class CredentialsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus, @Inject(AuditLog) private readonly audit: AuditLog) {}

  /** What the audit log keeps of a credential: where it is and its kind, never its value. */
  private target(project: string, environment: string, role: string) {
    return { type: "credential", id: `${project}/${environment}/${role}`.slice(0, 120), label: `${project} · ${environment} · ${role}` };
  }

  // Which credentials exist is itself sensitive enough to stay with the people who set them.
  @Requires("admin")
  @Get()
  list(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string) {
    return this.queries.execute(new ListCredentialsQuery(workspaceId, project, environment));
  }

  @Requires("admin")
  @Put(":role")
  async set(@CurrentActor() actor: Actor, @Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string, @Param("role") name: string, @Body() body: unknown) {
    const input = parse(credential, body);
    const result: { lastFour: string | null; rev: number } = await this.commands.execute(new SetCredentialCommand(workspaceId, project, environment, parse(role, name), input));
    await this.audit.record({ workspaceId, type: result.rev === 1 ? "credential.created" : "credential.updated", actor, target: this.target(project, environment, name), detail: { kind: input.kind, secretChanged: input.secret !== undefined } });
    return result;
  }

  @Requires("admin")
  @Delete(":role")
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string, @Param("role") name: string) {
    await this.commands.execute(new DeleteCredentialCommand(workspaceId, project, environment, parse(role, name)));
    await this.audit.record({ workspaceId, type: "credential.deleted", actor, target: this.target(project, environment, name) });
  }
}
