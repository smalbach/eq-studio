/**
 * What happened, as the command handlers publish it. Nothing subscribes to most of them yet:
 * they are the seam the run engine (P3) and sync (P7) attach to without touching the handlers.
 */
export class ProjectCreated { constructor(readonly workspaceId: string, readonly projectId: string) {} }
export class ProjectUpdated { constructor(readonly workspaceId: string, readonly projectId: string, readonly rev: number) {} }
export class ProjectArchived { constructor(readonly workspaceId: string, readonly projectId: string) {} }
export class SpecVersionImported { constructor(readonly workspaceId: string, readonly projectId: string, readonly specVersionId: string, readonly created: boolean) {} }
export class SpecVersionActivated { constructor(readonly workspaceId: string, readonly projectId: string, readonly specVersionId: string) {} }
export class ProjectConfigChanged { constructor(readonly workspaceId: string, readonly projectId: string, readonly sections: string[], readonly rev: number) {} }
export class EnvironmentChanged { constructor(readonly workspaceId: string, readonly projectId: string, readonly environmentId: string, readonly change: "created" | "updated" | "deleted") {} }
export class RunQueued { constructor(readonly workspaceId: string, readonly projectId: string, readonly runId: string, readonly kind: "functional" | "load") {} }
export class RunStarted { constructor(readonly workspaceId: string, readonly runId: string) {} }
export class RunCaseFinished { constructor(readonly workspaceId: string, readonly runId: string, readonly caseId: string, readonly status: string) {} }
export class RunFinished { constructor(readonly workspaceId: string, readonly runId: string, readonly status: string) {} }
