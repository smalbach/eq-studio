import { Inject, Injectable } from "@nestjs/common";
import { buildEndpoints, type Endpoint, type ProjectConfig } from "@eq/runner-core";
import type { EnvironmentRow, ProjectRow } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";
import { CredentialResolver, type Credentials } from "../../credentials/application/credential-resolver.ts";
import { EnvironmentRepository } from "../../environments/infrastructure/environment.repository.ts";
import { assembleConfig } from "../../projects/domain/project.ts";
import { ProjectRepository } from "../../projects/infrastructure/project.repository.ts";
import { SpecVersionRepository } from "../../specs/infrastructure/spec-version.repository.ts";

export const isLoopback = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);

/** What an environment allows, with the defaults its URL implies — the same rules as the UI. */
export function environmentSettings(environment: EnvironmentRow) {
  const local = isLoopback(environment.baseUrl);
  const seeded = environment.seeded ?? local;
  return { seeded, writesAllowed: environment.writesAllowed ?? seeded, enforceLatency: environment.enforceLatency ?? local, authEnabled: environment.authEnabled ?? false };
}

export type RunContext = { project: ProjectRow; environment: EnvironmentRow; config: ProjectConfig; endpoints: Endpoint[]; settings: ReturnType<typeof environmentSettings>; specVersionId: string | null };

/** The project, contract and environment a run works with, loaded the same way to plan it and to execute it. */
@Injectable()
export class RunContextLoader {
  constructor(
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
    @Inject(CredentialResolver) private readonly resolver: CredentialResolver,
  ) {}

  async load(workspaceId: string, projectId: string, environmentId: string, specVersionId?: string | null): Promise<RunContext> {
    const project = await this.projects.require(workspaceId, projectId);
    const environment = await this.environments.require(project.id, environmentId);
    const version = specVersionId === undefined ? project.activeSpecVersionId : specVersionId;
    if (!version) throw new Invalid("The project has no contract yet: import an OpenAPI document first");
    const config = assembleConfig(project.name, project.config, await this.versions.operations(version));
    return { project, environment, config, endpoints: buildEndpoints(config), settings: environmentSettings(environment), specVersionId: version };
  }

  credentials(context: RunContext): Promise<Credentials> {
    return this.resolver.forEnvironment(context.environment.id, context.config.auth?.apiKeyHeader, context.environment.baseUrl);
  }
}
