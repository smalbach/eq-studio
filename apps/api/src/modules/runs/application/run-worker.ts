import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import type { AppConfig } from "../../../config.ts";
import { APP_CONFIG, RUN_QUEUE } from "../../../shared/tokens.ts";
import { RunRepository } from "../infrastructure/run.repository.ts";
import type { RunQueue } from "../infrastructure/run-queue.ts";
import { RunExecutor } from "./run-executor.ts";

/**
 * Connects the queue to the executor and recovers after a restart: runs still queued are queued
 * again. With the in-memory queue a run that was executing died with the process, so it is
 * marked `interrupted` — its cases up to that point are kept, the rest are skipped. With Redis
 * another process may be executing it, so it is left alone.
 */
@Injectable()
export class RunWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(@Inject(RUN_QUEUE) private readonly queue: RunQueue, @Inject(RunExecutor) private readonly executor: RunExecutor, @Inject(RunRepository) private readonly runs: RunRepository, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onApplicationBootstrap() {
    this.queue.process((runId) => this.executor.execute(runId));
    if (this.config.queue.driver === "memory") {
      for (const run of await this.runs.withStatus(["running", "cancelling"])) {
        await this.runs.updateCasesWhere(run.id, ["queued", "running"], "skipped");
        await this.runs.update(run.id, { status: "interrupted", error: "The API stopped while this run was executing", finishedAt: new Date().toISOString() });
      }
    }
    await this.queue.start();
    for (const run of await this.runs.withStatus(["queued"])) await this.queue.enqueue(run.id);
  }

  /** Before the database closes: in-memory runs are asked to stop after their current case
   * (cleanup included), and the queue waits for them. */
  async beforeApplicationShutdown() {
    if (this.config.queue.driver === "memory") for (const run of await this.runs.withStatus(["running"])) await this.runs.update(run.id, { status: "cancelling" });
    await this.queue.close();
  }
}
