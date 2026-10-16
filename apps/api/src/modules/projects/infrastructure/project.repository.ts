import { Inject, Injectable } from "@nestjs/common";
import { IsNull, type DataSource, type EntityManager } from "typeorm";
import { ProjectEntity, type ProjectRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";

/** Projects of a workspace. Every read is scoped by workspace: no method takes an id alone. */
@Injectable()
export class ProjectRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private repo(tx?: EntityManager) {
    return (tx ?? this.db.manager).getRepository(ProjectEntity);
  }

  /** By id or by slug — URLs use either. Archived projects are not found. */
  async find(workspaceId: string, idOrSlug: string, tx?: EntityManager): Promise<ProjectRow | null> {
    return this.repo(tx).findOne({ where: [{ workspaceId, id: idOrSlug, deletedAt: IsNull() }, { workspaceId, slug: idOrSlug, deletedAt: IsNull() }] });
  }

  async require(workspaceId: string, idOrSlug: string, tx?: EntityManager): Promise<ProjectRow> {
    const row = await this.find(workspaceId, idOrSlug, tx);
    if (!row) throw new NotFound(`Project ${idOrSlug}`);
    return row;
  }

  list(workspaceId: string): Promise<ProjectRow[]> {
    return this.repo().find({ where: { workspaceId, deletedAt: IsNull() }, order: { name: "ASC" } });
  }

  async slugTaken(workspaceId: string, slug: string, tx?: EntityManager) {
    return (await this.repo(tx).count({ where: { workspaceId, slug } })) > 0;
  }

  async save(row: ProjectRow, tx?: EntityManager) {
    await withSyncSeq(this.db, tx, row.workspaceId, async (manager, seq) => { row.syncSeq = seq; await this.repo(manager).save(row); });
  }
}
