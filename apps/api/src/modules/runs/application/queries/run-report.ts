import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { renderReport, type ReportFormat } from "@eq/runner-core/report";
import { CredentialRepository } from "../../../credentials/infrastructure/credential.repository.ts";
import { EnvironmentRepository } from "../../../environments/infrastructure/environment.repository.ts";
import { ProjectRepository } from "../../../projects/infrastructure/project.repository.ts";
import { SpecVersionRepository } from "../../../specs/infrastructure/spec-version.repository.ts";
import { SecretBox } from "../../../../shared/secret-box.ts";
import { SECRET_BOX } from "../../../../shared/tokens.ts";
import { RunRepository } from "../../infrastructure/run.repository.ts";

export class RunReportQuery { constructor(readonly workspaceId: string, readonly runId: string, readonly format: ReportFormat, readonly locale: "es" | "en") {} }

/**
 * A run as a shareable report (HTML, SARIF or JUnit), rendered by the same code as the CLI's.
 * The environment's credentials are decrypted here only to be masked: a token the API echoed
 * back in a body never reaches the report.
 */
@QueryHandler(RunReportQuery)
export class RunReportHandler implements IQueryHandler<RunReportQuery> {
  constructor(
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
    @Inject(SpecVersionRepository) private readonly versions: SpecVersionRepository,
    @Inject(CredentialRepository) private readonly credentials: CredentialRepository,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  async execute({ workspaceId, runId, format, locale }: RunReportQuery) {
    const run = await this.runs.require(workspaceId, runId);
    const project = await this.projects.require(workspaceId, run.projectId);
    const environment = await this.environments.require(project.id, run.environmentId).catch(() => null);
    const version = run.specVersionId ? await this.versions.require(project.id, run.specVersionId).catch(() => null) : null;
    const cases = run.kind === "functional" ? await this.runs.casesOf(run.id, true) : [];
    const rendered = renderReport(format, { ...run, cases }, {
      project: project.slug, environment: environment?.name ?? run.environmentId, baseUrl: environment?.baseUrl,
      contractVersion: version?.version ?? null, secrets: environment ? await this.secretsOf(environment.id) : [], locale,
    });
    return { ...rendered, filename: `${project.slug}-${run.id}.${rendered.extension}` };
  }

  private async secretsOf(environmentId: string) {
    const secrets: string[] = [];
    for (const row of await this.credentials.list(environmentId)) {
      try { if (row.secret) secrets.push(this.box.decrypt(row.secret, row.id)); } catch { /* not decryptable here: the pattern masks still apply */ }
    }
    return secrets;
  }
}
