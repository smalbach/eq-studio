import { Queue, Worker } from "bullmq";
import type { RunJob, RunQueue } from "./run-queue.ts";

const QUEUE = "eq-runs";

/**
 * Runs on Redis through BullMQ: any number of API processes take jobs, and a job outlives the
 * process that enqueued it. The run id is the job id, so enqueueing twice is a no-op.
 */
export class BullMqRunQueue implements RunQueue {
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private job: RunJob | null = null;

  constructor(private readonly url: string, private readonly concurrency: number, private readonly prefix = "eq") {
    this.queue = new Queue(QUEUE, { connection: { url }, prefix });
  }

  process(job: RunJob) { this.job = job; }

  async start() {
    const job = this.job;
    if (!job) throw new Error("No run job registered");
    this.worker = new Worker(QUEUE, async (item) => job(String(item.data.runId)), { connection: { url: this.url }, prefix: this.prefix, concurrency: this.concurrency });
    await this.worker.waitUntilReady();
  }

  async enqueue(runId: string) {
    await this.queue.add("run", { runId }, { jobId: runId, removeOnComplete: 1000, removeOnFail: 1000 });
  }

  async idle() {
    for (;;) {
      const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "prioritized");
      if (Object.values(counts).every((count) => count === 0)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}
