import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { AppConfig } from "../../../config.ts";
import type { ScheduleRow } from "../../../database/entities.ts";
import { NotFound } from "../../../shared/errors.ts";
import { isoNow } from "../../../shared/ids.ts";
import type { Actor } from "../../../shared/rbac.ts";
import { APP_CONFIG } from "../../../shared/tokens.ts";
import { StartLoadRunCommand, StartRunCommand } from "../../runs/application/commands/start-run.ts";
import { isFinished, type FunctionalPlan, type LoadPlan } from "../../runs/domain/run.ts";
import { nextOccurrence } from "../domain/cron.ts";
import { ScheduleRepository } from "../infrastructure/schedule.repository.ts";

const stillRunning = (status: string | undefined) => Boolean(status) && !isFinished(status as never);

/**
 * Fires due schedules, from inside the API process: a timer every `EQ_SCHEDULER_TICK_SECONDS`.
 *
 * Every process runs it, and that is safe: an occurrence is claimed with a compare-and-set on
 * `next_run_at` (see `ScheduleRepository.claim`), so exactly one process starts the run, and the
 * run itself goes through the same queue as one started by hand. An API that was down fires a
 * missed schedule once when it comes back, not once per missed occurrence.
 */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Scheduler");
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<number> | null = null;

  constructor(@Inject(ScheduleRepository) private readonly schedules: ScheduleRepository, @Inject(CommandBus) private readonly commands: CommandBus, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onApplicationBootstrap() {
    const seconds = this.config.scheduler?.tickSeconds ?? 30;
    if (!seconds) return;
    this.timer = setInterval(() => { void this.tick(); }, seconds * 1000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.ticking;
  }

  /** One pass over what is due. Answers how many runs it started. Overlapping calls share one pass. */
  tick(now = new Date()): Promise<number> {
    this.ticking ??= this.pass(now).finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async pass(now: Date) {
    let started = 0;
    const stamp = now.toISOString();
    for (const row of await this.schedules.due(stamp)) {
      let next: string;
      try { next = nextOccurrence(row.cron, now).toISOString(); } catch (error) { await this.schedules.update(row.id, { enabled: false, nextRunAt: null, lastError: (error as Error).message }); continue; }
      if (!await this.schedules.claim(row, next, stamp)) continue;
      if (await this.fire(row)) started += 1;
    }
    return started;
  }

  /** Starts the schedule's run now. A run of the same schedule still in progress is not doubled:
   * this occurrence is skipped and says so. */
  async fire(row: ScheduleRow): Promise<string | null> {
    const previous = row.lastRunId ? (await this.schedules.runStatuses([row.lastRunId])).get(row.lastRunId) : undefined;
    if (stillRunning(previous)) { await this.schedules.update(row.id, { lastError: "Skipped: the previous run of this schedule was still in progress" }); return null; }
    // The role was checked when the schedule was saved; the clock acts with the schedule's authority.
    const actor: Actor = { workspaceId: row.workspaceId, role: "owner", userId: null, tokenId: null, local: false };
    const triggeredBy = `schedule:${row.id}`;
    try {
      const { id } = row.kind === "functional"
        ? await this.commands.execute(new StartRunCommand(row.workspaceId, row.projectId, row.environmentId, row.plan as unknown as FunctionalPlan, undefined, triggeredBy, actor)) as { id: string }
        : await this.commands.execute(new StartLoadRunCommand(row.workspaceId, row.projectId, row.environmentId, { ...(row.plan as unknown as LoadPlan), peakRps: (row.plan.peakRps as number | undefined) ?? (row.plan.baseRps as number) }, triggeredBy)) as { id: string };
      await this.schedules.update(row.id, { lastRunId: id, lastRunAt: isoNow(), lastError: null });
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The project or environment is gone: the schedule stops instead of failing forever.
      await this.schedules.update(row.id, { lastError: message, ...(error instanceof NotFound ? { enabled: false, nextRunAt: null } : {}) });
      this.logger.warn(`Schedule ${row.id} did not start: ${message}`);
      return null;
    }
  }
}
