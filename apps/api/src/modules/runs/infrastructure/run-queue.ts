/**
 * Where started runs wait for a worker. Two adapters behind one port, chosen by
 * `EQ_QUEUE_DRIVER`: in memory (local, no infrastructure) and BullMQ on Redis (cloud: several
 * workers, survives a restart of any of them). The rest of the code does not know which one runs.
 */
export type RunJob = (runId: string) => Promise<void>;

export interface RunQueue {
  /** Registers the function that executes a run. Called once, before `start`. */
  process(job: RunJob): void;
  start(): Promise<void>;
  enqueue(runId: string): Promise<void>;
  /** Waits for the runs in progress to finish their current case, then stops taking new ones. */
  close(): Promise<void>;
  /** Resolves when nothing is waiting or running. For tests and graceful shutdown. */
  idle(): Promise<void>;
}

/** A FIFO with a concurrency limit, in this process. A restart loses the waiting runs; the
 * recovery on boot puts them back from the database. */
export class InMemoryRunQueue implements RunQueue {
  private job: RunJob | null = null;
  private waiting: string[] = [];
  private running = 0;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  process(job: RunJob) { this.job = job; }
  async start() { this.pump(); }

  async enqueue(runId: string) {
    if (this.closed) return;
    if (!this.waiting.includes(runId)) this.waiting.push(runId);
    this.pump();
  }

  private pump() {
    while (this.job && !this.closed && this.running < this.concurrency && this.waiting.length) {
      const runId = this.waiting.shift()!;
      this.running += 1;
      this.job(runId).catch((error) => console.error(`Run ${runId} crashed`, error)).finally(() => {
        this.running -= 1;
        this.pump();
        this.settle();
      });
    }
    this.settle();
  }

  private settle() {
    if (this.running === 0 && (this.waiting.length === 0 || this.closed)) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  idle() { return new Promise<void>((resolve) => { this.idleWaiters.push(resolve); this.settle(); }); }

  async close() {
    this.closed = true;
    await this.idle();
  }
}
