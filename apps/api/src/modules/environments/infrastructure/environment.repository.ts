import { Inject, Injectable } from "@nestjs/common";
import { IsNull, type DataSource, type EntityManager } from "typeorm";
import { EnvironmentEntity, type EnvironmentRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

@Injectable()
export class EnvironmentRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private repo(tx?: EntityManager) {
    return (tx ?? this.db.manager).getRepository(EnvironmentEntity);
  }

  list(projectId: string, tx?: EntityManager): Promise<EnvironmentRow[]> {
    return this.repo(tx).find({ where: { projectId, deletedAt: IsNull() }, order: { createdAt: "ASC", id: "ASC" } });
  }

  /** By id or by its key in the project file. */
  async require(projectId: string, idOrKey: string, tx?: EntityManager): Promise<EnvironmentRow> {
    const row = await this.repo(tx).findOne({ where: [{ projectId, id: idOrKey, deletedAt: IsNull() }, { projectId, key: idOrKey, deletedAt: IsNull() }] });
    if (!row) throw new NotFound(`Environment ${idOrKey}`);
    return row;
  }

  async keyTaken(projectId: string, key: string, tx?: EntityManager) {
    return (await this.repo(tx).count({ where: { projectId, key } })) > 0;
  }

  async save(row: EnvironmentRow, tx?: EntityManager) {
    await withSyncSeq(this.db, tx, row.workspaceId, async (manager, seq) => { row.syncSeq = seq; await this.repo(manager).save(row); });
  }
}
