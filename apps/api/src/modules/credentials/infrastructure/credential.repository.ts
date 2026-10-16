import { Inject, Injectable } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";
import { CredentialEntity, type CredentialRole, type CredentialRow } from "../../../database/entities.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

@Injectable()
export class CredentialRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private repo(tx?: EntityManager) {
    return (tx ?? this.db.manager).getRepository(CredentialEntity);
  }

  list(environmentId: string): Promise<CredentialRow[]> {
    return this.repo().find({ where: { environmentId }, order: { role: "ASC" } });
  }

  find(environmentId: string, role: CredentialRole) {
    return this.repo().findOne({ where: { environmentId, role } });
  }

  async save(row: CredentialRow, tx?: EntityManager) {
    await withSyncSeq(this.db, tx, row.workspaceId, async (manager, seq) => { row.syncSeq = seq; await this.repo(manager).save(row); });
  }

  async deleteAll(environmentId: string) {
    await this.repo().delete({ environmentId });
  }

  async delete(environmentId: string, role: CredentialRole) {
    return (await this.repo().delete({ environmentId, role })).affected ?? 0;
  }
}
