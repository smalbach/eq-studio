import { Inject, Injectable } from "@nestjs/common";
import { In, LessThan, Not, type DataSource } from "typeorm";
import { NotificationTargetEntity, RunEntity, type NotificationTargetRow, type RunRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private repo() { return this.db.manager.getRepository(NotificationTargetEntity); }

  list(projectId: string) { return this.repo().find({ where: { projectId }, order: { createdAt: "ASC" } }); }
  enabled(projectId: string) { return this.repo().find({ where: { projectId, enabled: true } }); }

  async require(projectId: string, id: string) {
    const row = await this.repo().findOne({ where: { projectId, id } });
    if (!row) throw new NotFound(`Notification target ${id}`);
    return row;
  }

  async save(row: NotificationTargetRow) { await this.repo().save(row); }
  async delete(id: string) { await this.repo().delete({ id }); }
  async update(id: string, changes: Partial<NotificationTargetRow>) { await this.repo().update({ id }, changes as never); }

  run(id: string) { return this.db.manager.getRepository(RunEntity).findOne({ where: { id } }); }

  /** The last run before this one with a verdict, on the same project, environment and kind. */
  previousWithVerdict(run: RunRow) {
    return this.db.manager.getRepository(RunEntity).findOne({ where: { projectId: run.projectId, environmentId: run.environmentId, kind: run.kind, id: Not(run.id), createdAt: LessThan(run.createdAt), status: In(["passed", "failed", "error"]) }, order: { createdAt: "DESC", id: "DESC" }, select: ["id", "status"] });
  }
}
