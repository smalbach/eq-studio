import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { Requires } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { DeleteCredentialCommand, SetCredentialCommand } from "../application/commands/credential-commands.ts";
import { ListCredentialsQuery } from "../application/queries/list-credentials.ts";
import { CREDENTIAL_KINDS } from "../domain/credential.ts";

const role = z.enum(["primary", "insufficient", "alternate"]);
const optional = z.string().max(2000).nullable().optional();
const header = z.string().max(200).regex(/^[A-Za-z0-9-]+$/, "a header name");
const pem = (label: string) => z.string().max(65_536).regex(new RegExp(`-----BEGIN ${label}-----`), `a PEM ${label.toLowerCase()}`);
const extraSecret = z.string().max(65_536).nullable().optional();
const options = z.object({
  cookieName: z.string().max(200).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "a cookie name").optional(),
  login: z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(), path: z.string().min(1).max(2000), body: z.string().max(8000).optional(), contentType: z.string().max(200).optional() }).optional(),
  hmac: z.object({ algorithm: z.enum(["sha256", "sha512"]).optional(), header: header.optional(), keyId: z.string().max(500).optional(), keyIdHeader: header.optional(), timestampHeader: header.optional(), template: z.string().max(2000).optional(), encoding: z.enum(["hex", "base64"]).optional() }).optional(),
  tls: z.object({ cert: pem("CERTIFICATE"), ca: pem("CERTIFICATE").optional() }).optional(),
}).strict();
const credential = z.object({
  kind: z.enum(CREDENTIAL_KINDS), secret: z.string().max(8000).optional(), headerName: header.nullable().optional(), username: optional, tokenUrl: z.url({ protocol: /^https?$/ }).nullable().optional(), clientId: optional, scope: optional,
  options: options.nullable().optional(), refreshToken: extraSecret, tlsKey: extraSecret, tlsPassphrase: extraSecret,
});

@Controller("v1/projects/:project/environments/:environment/credentials")
export class CredentialsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus) {}

  // Which credentials exist is itself sensitive enough to stay with the people who set them.
  @Requires("admin")
  @Get()
  list(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string) {
    return this.queries.execute(new ListCredentialsQuery(workspaceId, project, environment));
  }

  @Requires("admin")
  @Put(":role")
  set(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string, @Param("role") name: string, @Body() body: unknown) {
    return this.commands.execute(new SetCredentialCommand(workspaceId, project, environment, parse(role, name), parse(credential, body)));
  }

  @Requires("admin")
  @Delete(":role")
  @HttpCode(204)
  async remove(@Workspace() workspaceId: string, @Param("project") project: string, @Param("environment") environment: string, @Param("role") name: string) {
    await this.commands.execute(new DeleteCredentialCommand(workspaceId, project, environment, parse(role, name)));
  }
}
