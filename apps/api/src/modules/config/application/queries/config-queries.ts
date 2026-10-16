import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { buildEndpoints, buildQueue, runnableScenarios, type CaseSelection, type Locale, type OrderMode, type ProjectConfig } from "@eq/runner-core";
import { ProjectReader } from "../../../projects/application/project-reader.ts";

export class GetProjectConfigQuery { constructor(readonly workspaceId: string, readonly projectId: string) {} }

@QueryHandler(GetProjectConfigQuery)
export class GetProjectConfigHandler implements IQueryHandler<GetProjectConfigQuery, { rev: number; config: ProjectConfig }> {
  constructor(@Inject(ProjectReader) private readonly reader: ProjectReader) {}

  async execute({ workspaceId, projectId }: GetProjectConfigQuery) {
    const { project, file } = await this.reader.snapshot(workspaceId, projectId);
    return { rev: project.rev, config: file.project };
  }
}

export class GetScenariosQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly authEnabled: boolean, readonly locale: Locale) {} }

/** Every case the engine generates, per operation — the same matrix the dashboard runs. */
@QueryHandler(GetScenariosQuery)
export class GetScenariosHandler implements IQueryHandler<GetScenariosQuery> {
  constructor(@Inject(ProjectReader) private readonly reader: ProjectReader) {}

  async execute({ workspaceId, projectId, authEnabled, locale }: GetScenariosQuery) {
    const { file } = await this.reader.snapshot(workspaceId, projectId);
    const endpoints = buildEndpoints(file.project);
    const operations = endpoints.map((endpoint) => ({ operationId: endpoint.id, method: endpoint.method, path: endpoint.path, implemented: endpoint.implemented, scenarios: runnableScenarios(endpoint, file.project, authEnabled, locale) }));
    return { total: operations.reduce((sum, item) => sum + item.scenarios.length, 0), operations };
  }
}

export class PreviewQueueQuery { constructor(readonly workspaceId: string, readonly projectId: string, readonly options: { mode: OrderMode; customOrder: string[]; endpointIds?: string[]; caseSelection: CaseSelection; authEnabled: boolean; locale: Locale; readOnly: boolean }) {} }

/** The queue a run would walk, in order, without running anything. */
@QueryHandler(PreviewQueueQuery)
export class PreviewQueueHandler implements IQueryHandler<PreviewQueueQuery> {
  constructor(@Inject(ProjectReader) private readonly reader: ProjectReader) {}

  async execute({ workspaceId, projectId, options }: PreviewQueueQuery) {
    const { file } = await this.reader.snapshot(workspaceId, projectId);
    const endpoints = buildEndpoints(file.project).filter((endpoint) => !options.readOnly || endpoint.method === "GET");
    const queue = buildQueue(endpoints, file.project, options);
    return { total: queue.length, items: queue.map(({ endpoint, scenario }) => ({ operationId: endpoint.id, method: endpoint.method, path: endpoint.path, scenarioId: scenario.id, name: scenario.name, expectedStatus: scenario.expectedStatus, flow: scenario.flow, auth: scenario.auth ?? "default" })) };
  }
}
