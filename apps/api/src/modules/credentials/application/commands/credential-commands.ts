import { Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { CredentialKind, CredentialOptions, CredentialRole, CredentialRow } from "../../../../database/entities.ts";
import { NotFound } from "../../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../../shared/ids.ts";
import { lastFour, SecretBox } from "../../../../shared/secret-box.ts";
import { SECRET_BOX } from "../../../../shared/tokens.ts";
import { EnvironmentRepository } from "../../../environments/infrastructure/environment.repository.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { openExtras, SECRET_NAMES, sealExtras, validateCredential } from "../../domain/credential.ts";
import { CredentialRepository } from "../../infrastructure/credential.repository.ts";

export type CredentialInput = {
  kind: CredentialKind; secret?: string; headerName?: string | null; username?: string | null; tokenUrl?: string | null; clientId?: string | null; scope?: string | null;
  options?: CredentialOptions | null;
  /** The secrets besides `secret`; like it, left out keeps the stored one and empty clears it. */
  refreshToken?: string | null; tlsKey?: string | null; tlsPassphrase?: string | null;
};

export class SetCredentialCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly role: CredentialRole, readonly input: CredentialInput) {} }

/**
 * Creates or replaces the credential of a role. Sent without `secret`, an existing one keeps its
 * secret — a form can change the header name without asking for the token again.
 */
@CommandHandler(SetCredentialCommand)
export class SetCredentialHandler implements ICommandHandler<SetCredentialCommand, { lastFour: string | null; rev: number }> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(CredentialRepository) private readonly credentials: CredentialRepository, @Inject(SECRET_BOX) private readonly box: SecretBox) {}

  async execute({ workspaceId, projectId, environmentId, role, input }: SetCredentialCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const environment = await this.environments.require(project.id, environmentId);
    const existing = await this.credentials.find(environment.id, role);
    const now = isoNow();
    const row: CredentialRow = existing ?? { id: uuidv7(), workspaceId, environmentId: environment.id, role, kind: input.kind, headerName: null, username: null, tokenUrl: null, clientId: null, scope: null, secret: null, lastFour: null, options: null, extraSecrets: null, secretHints: null, rev: 0, createdAt: now, updatedAt: now };
    row.kind = input.kind;
    for (const field of ["headerName", "username", "tokenUrl", "clientId", "scope"] as const) if (input[field] !== undefined) row[field] = input[field] ?? null;
    if (input.options !== undefined) row.options = input.options ?? null;
    if (input.secret !== undefined) {
      row.secret = input.secret ? this.box.encrypt(input.secret, row.id) : null;
      row.lastFour = input.secret ? lastFour(input.secret) : null;
    }
    const extras = openExtras(row, this.box);
    for (const name of SECRET_NAMES) if (input[name] !== undefined) extras[name] = input[name] || undefined;
    validateCredential(row, extras, row.secret ? this.box.decrypt(row.secret, row.id) : null);
    sealExtras(row, extras, this.box);
    row.rev += 1;
    row.updatedAt = now;
    await this.credentials.save(row);
    return { lastFour: row.lastFour, rev: row.rev };
  }
}

export class DeleteCredentialCommand { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly role: CredentialRole) {} }

/** Removes the secret for good: credentials are never soft-deleted. */
@CommandHandler(DeleteCredentialCommand)
export class DeleteCredentialHandler implements ICommandHandler<DeleteCredentialCommand, void> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(CredentialRepository) private readonly credentials: CredentialRepository) {}

  async execute({ workspaceId, projectId, environmentId, role }: DeleteCredentialCommand) {
    const project = await this.projects.require(workspaceId, projectId);
    const environment = await this.environments.require(project.id, environmentId);
    if (!await this.credentials.delete(environment.id, role)) throw new NotFound(`Credential ${role}`);
  }
}
