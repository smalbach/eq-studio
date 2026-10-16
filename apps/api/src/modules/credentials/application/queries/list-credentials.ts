import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { EnvironmentRepository } from "../../../environments/infrastructure/environment.repository.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { CredentialRepository } from "../../infrastructure/credential.repository.ts";

export class ListCredentialsQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string) {} }

/** What is configured, never the secret itself: its last four characters at most. */
@QueryHandler(ListCredentialsQuery)
export class ListCredentialsHandler implements IQueryHandler<ListCredentialsQuery> {
  constructor(@Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(CredentialRepository) private readonly credentials: CredentialRepository) {}

  async execute({ workspaceId, projectId, environmentId }: ListCredentialsQuery) {
    const project = await this.projects.require(workspaceId, projectId);
    const environment = await this.environments.require(project.id, environmentId);
    const rows = await this.credentials.list(environment.id);
    return rows.map(({ role, kind, headerName, username, tokenUrl, clientId, scope, lastFour, rev, updatedAt }) => ({ role, kind, headerName, username, tokenUrl, clientId, scope, lastFour, hasSecret: Boolean(lastFour), rev, updatedAt }));
  }
}
