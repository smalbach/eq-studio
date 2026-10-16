import { Inject, Injectable } from "@nestjs/common";
import { In, type DataSource, type EntityManager } from "typeorm";
import { RunCaseEntity, RunEntity, type CaseStatus, type RunCaseRow, type RunKind, type RunRow, type RunStatus } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

@Injectable()
export class RunRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private runs(tx?: EntityManager) { return (tx ?? this.db.manager).getRepository(RunEntity); }
  private cases(tx?: EntityManager) { return (tx ?? this.db.manager).getRepository(RunCaseEntity); }

  async insert(run: RunRow, cases: RunCaseRow[], tx: EntityManager) {
    // JSON columns hold `unknown` bodies, which TypeORM's deep-partial types cannot express.
    await withSyncSeq(this.db, tx, run.workspaceId, async (manager, seq) => { await this.runs(manager).insert({ ...run, syncSeq: seq } as never); });
    for (let index = 0; index < cases.length; index += 50) await this.cases(tx).insert(cases.slice(index, index + 50) as never);
  }

  /** Scoped by workspace: a run id from another workspace is a 404, not a leak. */
  async require(workspaceId: string, id: string): Promise<RunRow> {
    const row = await this.runs().findOne({ where: { workspaceId, id } });
    if (!row) throw new NotFound(`Run ${id}`);
    return row;
  }

  get(id: string) { return this.runs().findOne({ where: { id } }); }

  /** Newest first. `full` adds what the history views analyse: the plan and the load report. */
  list(projectId: string, kind: RunKind | undefined, limit: number, full = false) {
    const summary: (keyof RunRow)[] = ["id", "projectId", "environmentId", "kind", "status", "scope", "totals", "createdAt", "startedAt", "finishedAt", "durationMs", "triggeredBy", "error"];
    return this.runs().find({ where: { projectId, ...(kind ? { kind } : {}) }, order: { createdAt: "DESC", id: "DESC" }, take: limit, select: full ? [...summary, "plan", "report"] : summary });
  }

  async delete(id: string) {
    await this.db.transaction(async (tx) => {
      await this.cases(tx).delete({ runId: id });
      await this.runs(tx).delete({ id });
    });
  }

  caseById(id: string) { return this.cases().findOne({ where: { id } }); }

  casesOf(runId: string, withSteps = true) {
    return this.cases().find({ where: { runId }, order: { position: "ASC" }, ...(withSteps ? {} : { select: ["id", "runId", "position", "operationId", "scenarioId", "name", "method", "path", "expectedStatus", "status", "durationMs"] }) });
  }

  /** A run that finishes takes a new change number: that is when sync picks it up. */
  async update(id: string, changes: Partial<RunRow>) {
    if (!changes.finishedAt) { await this.runs().update({ id }, changes as never); return; }
    const run = await this.runs().findOne({ where: { id }, select: ["id", "workspaceId"] });
    if (!run) return;
    await withSyncSeq(this.db, undefined, run.workspaceId, async (manager, seq) => { await this.runs(manager).update({ id }, { ...changes, syncSeq: seq } as never); });
  }
  async updateCase(id: string, changes: Partial<RunCaseRow>) { await this.cases().update({ id }, changes as never); }
  async updateCasesWhere(runId: string, from: CaseStatus[], to: CaseStatus) { await this.cases().update({ runId, status: In(from) }, { status: to }); }

  async status(id: string): Promise<RunStatus | undefined> {
    return (await this.runs().findOne({ where: { id }, select: ["id", "status"] }))?.status;
  }

  withStatus(statuses: RunStatus[]) { return this.runs().find({ where: { status: In(statuses) }, order: { createdAt: "ASC" } }); }
}
