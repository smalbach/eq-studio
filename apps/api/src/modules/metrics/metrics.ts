/**
 * Prometheus metrics, off unless `EQ_METRICS=true`: the process (CPU, memory, event loop, GC),
 * every HTTP request by route, method and status with its duration, runs queued, started and
 * finished, and the runs waiting or in progress right now.
 *
 * One registry per application (not the library's global one), so two applications in one
 * process — the tests — count apart. The counters are this process's; with several API processes
 * Prometheus scrapes each and sums. The queue depth is read from the database at each scrape, so
 * every process reports the same, whichever queue driver runs.
 */
import { Inject, Injectable } from "@nestjs/common";
import { EventsHandler, type IEventHandler } from "@nestjs/cqrs";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import { In, type DataSource } from "typeorm";
import { RunEntity } from "../../database/entities.ts";
import type { AppConfig } from "../../config.ts";
import { APP_CONFIG, DATA_SOURCE } from "../../shared/tokens.ts";
import { RunFinished, RunQueued, RunStarted } from "../shared/events.ts";

type Request = { method: string; baseUrl?: string; route?: { path?: string }; path: string };
type Response = { statusCode: number; on(event: "finish", listener: () => void): void };

const WAITING = ["queued", "running", "cancelling"] as const;

@Injectable()
export class Metrics {
  readonly registry = new Registry();
  private readonly requests = new Histogram({ name: "eq_http_request_duration_seconds", help: "HTTP requests by route, method and status, with their duration", labelNames: ["method", "route", "status"] as const, buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: [this.registry] });
  readonly runsQueued = new Counter({ name: "eq_runs_queued_total", help: "Runs started by someone, by kind", labelNames: ["kind"] as const, registers: [this.registry] });
  readonly runsStarted = new Counter({ name: "eq_runs_started_total", help: "Runs a worker of this process began executing", registers: [this.registry] });
  readonly runsFinished = new Counter({ name: "eq_runs_finished_total", help: "Runs finished, by final status", labelNames: ["status"] as const, registers: [this.registry] });

  constructor(@Inject(DATA_SOURCE) db: DataSource, @Inject(APP_CONFIG) config: AppConfig) {
    // The process metrics sample the event loop: only when someone reads them.
    if (config.metrics?.enabled) collectDefaultMetrics({ register: this.registry });
    new Gauge({
      name: "eq_run_queue_depth", help: "Runs waiting for a worker (queued) or being executed (running, cancelling), in the whole deployment", labelNames: ["status"] as const, registers: [this.registry],
      async collect() {
        const rows: { status: string; count: string | number }[] = await db.getRepository(RunEntity).createQueryBuilder("run").select("run.status", "status").addSelect("COUNT(*)", "count").where({ status: In([...WAITING]) }).groupBy("run.status").getRawMany();
        for (const status of WAITING) this.set({ status }, Number(rows.find((row) => row.status === status)?.count ?? 0));
      },
    });
  }

  /** Times every request. The route is the matched pattern (`/v1/runs/:id`), never the raw path: ids would explode the series. */
  readonly middleware = (request: Request, response: Response, next: () => void) => {
    const end = this.requests.startTimer();
    response.on("finish", () => {
      const pattern = request.route?.path;
      const route = pattern ? `${request.baseUrl ?? ""}${pattern}` : request.path.startsWith("/v1/") ? "unmatched" : "static";
      end({ method: request.method, route, status: String(response.statusCode) });
    });
    next();
  };

  text() { return this.registry.metrics(); }
  get contentType() { return this.registry.contentType; }
}

@EventsHandler(RunQueued, RunStarted, RunFinished)
export class RunMetrics implements IEventHandler<RunQueued | RunStarted | RunFinished> {
  constructor(@Inject(Metrics) private readonly metrics: Metrics) {}

  handle(event: RunQueued | RunStarted | RunFinished) {
    if (event instanceof RunQueued) this.metrics.runsQueued.inc({ kind: event.kind });
    else if (event instanceof RunStarted) this.metrics.runsStarted.inc();
    else this.metrics.runsFinished.inc({ status: event.status });
  }
}
