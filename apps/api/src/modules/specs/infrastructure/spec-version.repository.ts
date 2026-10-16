import { Inject, Injectable } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";
import type { ProjectOperation } from "@eq/runner-core";
import { OperationEntity, SpecVersionEntity, type OperationRow, type SpecVersionRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { uuidv7 } from "../../../shared/ids.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

/** Immutable snapshots of a project's contract and the operations each one declares. */
@Injectable()
export class SpecVersionRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private manager(tx?: EntityManager) {
    return tx ?? this.db.manager;
  }

  findByHash(projectId: string, hash: string, tx?: EntityManager) {
    return this.manager(tx).getRepository(SpecVersionEntity).findOne({ where: { projectId, hash } });
  }

  async require(projectId: string, id: string, tx?: EntityManager): Promise<SpecVersionRow> {
    const row = await this.manager(tx).getRepository(SpecVersionEntity).findOne({ where: { projectId, id } });
    if (!row) throw new NotFound(`Spec version ${id}`);
    return row;
  }

  /** Newest first; the document itself is left out of the listing. */
  list(projectId: string) {
    return this.manager().getRepository(SpecVersionEntity).find({ where: { projectId }, order: { createdAt: "DESC", id: "DESC" }, select: ["id", "projectId", "hash", "sourceKind", "sourceUrl", "openapiVersion", "title", "version", "operationCount", "createdAt"] });
  }

  async insert(version: SpecVersionRow, operations: ProjectOperation[], tx?: EntityManager) {
    await withSyncSeq(this.db, tx, version.workspaceId, async (manager, seq) => this.insertWith(manager, { ...version, syncSeq: seq }, operations));
  }

  private async insertWith(manager: EntityManager, version: SpecVersionRow, operations: ProjectOperation[]) {
    await manager.getRepository(SpecVersionEntity).insert(version);
    const rows: OperationRow[] = operations.map((operation, position) => ({ id: uuidv7(), specVersionId: version.id, operationId: operation.id, method: operation.method, path: operation.path, tag: operation.tag, summary: operation.summary, statuses: operation.statuses, parameters: operation.parameters, internal: Boolean(operation.internal), position }));
    // In chunks: SQLite caps the number of bound parameters per statement.
    for (let index = 0; index < rows.length; index += 50) await manager.getRepository(OperationEntity).insert(rows.slice(index, index + 50));
  }

  async operations(specVersionId: string | null, tx?: EntityManager): Promise<ProjectOperation[]> {
    if (!specVersionId) return [];
    const rows = await this.manager(tx).getRepository(OperationEntity).find({ where: { specVersionId }, order: { position: "ASC" } });
    return rows.map((row) => ({ id: row.operationId, method: row.method as ProjectOperation["method"], path: row.path, tag: row.tag, summary: row.summary, statuses: row.statuses, parameters: row.parameters, ...(row.internal ? { internal: true } : {}) }));
  }
}
