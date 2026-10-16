import { Inject, Injectable } from "@nestjs/common";
import { In, LessThanOrEqual, type DataSource } from "typeorm";
import { RunEntity, ScheduleEntity, type RunStatus, type ScheduleRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";

@Injectable()
export class ScheduleRepository {
  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource) {}

  private repo() { return this.db.manager.getRepository(ScheduleEntity); }

  list(projectId: string) { return this.repo().find({ where: { projectId }, order: { createdAt: "ASC" } }); }

  async require(projectId: string, id: string) {
    const row = await this.repo().findOne({ where: { projectId, id } });
    if (!row) throw new NotFound(`Schedule ${id}`);
    return row;
  }

  get(id: string) { return this.repo().findOne({ where: { id } }); }
  async save(row: ScheduleRow) { await this.repo().save(row); }
  async delete(id: string) { await this.repo().delete({ id }); }
  async update(id: string, changes: Partial<ScheduleRow>) { await this.repo().update({ id }, changes as never); }

  /** Enabled and due, oldest first. */
  due(now: string) { return this.repo().find({ where: { enabled: true, nextRunAt: LessThanOrEqual(now) }, order: { nextRunAt: "ASC" }, take: 100 }); }

  /**
   * Takes one occurrence: moves `nextRunAt` from the value this process read to the next one.
   * Only one UPDATE can match the old value, so with any number of API processes over the same
   * database exactly one of them fires it — the others see zero rows changed and move on.
   */
  async claim(row: ScheduleRow, nextRunAt: string, now: string) {
    const result = await this.repo().createQueryBuilder().update().set({ nextRunAt, lastRunAt: now }).where("id = :id AND next_run_at = :previous", { id: row.id, previous: row.nextRunAt }).execute();
    return result.affected === 1;
  }

  async runStatuses(ids: string[]): Promise<Map<string, RunStatus>> {
    if (!ids.length) return new Map();
    const rows = await this.db.manager.getRepository(RunEntity).find({ where: { id: In(ids) }, select: ["id", "status"] });
    return new Map(rows.map((row) => [row.id, row.status]));
  }
}
