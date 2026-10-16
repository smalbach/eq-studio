import { Inject, Injectable } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { isFinished } from "../domain/run.ts";
import { RunRepository } from "../infrastructure/run.repository.ts";

const POLL_MS = 300;

/**
 * The live view of a run, read from the database rather than from the process executing it:
 * with several API processes behind a balancer, the one serving the stream is rarely the one
 * running the cases. A client that cannot keep a stream open (some corporate proxies buffer
 * them) gets the same data by polling `GET /v1/runs/:id`.
 *
 * Events: `snapshot` (the run and its cases), `case` (a case changed state; a finished one with
 * its steps), `progress` (the
 * totals or the load test's live windows), `finished` (the final run), then the stream ends.
 */
@Injectable()
export class RunStream {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  follow(workspaceId: string, runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      const loop = async () => {
        try {
          const run = await this.runs.require(workspaceId, runId);
          let cases = await this.runs.casesOf(run.id, false);
          subscriber.next({ type: "snapshot", data: { run, cases } });
          const seen = new Map(cases.map((item) => [item.id, item.status]));
          let last = JSON.stringify([run.status, run.totals, (run.report as { windows?: unknown[] } | null)?.windows?.length]);
          let current = run;
          while (!stopped && !isFinished(current.status)) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            current = (await this.runs.get(run.id)) ?? current;
            cases = await this.runs.casesOf(run.id, false);
            for (const item of cases) {
              if (seen.get(item.id) === item.status) continue;
              seen.set(item.id, item.status);
              // A finished case comes with its steps: what the monitor shows without a second request.
              const finished = !["queued", "running"].includes(item.status);
              subscriber.next({ type: "case", data: finished ? (await this.runs.caseById(item.id)) ?? item : item });
            }
            const windows = (current.report as { windows?: unknown[] } | null)?.windows;
            const key = JSON.stringify([current.status, current.totals, windows?.length]);
            if (key !== last) { last = key; subscriber.next({ type: "progress", data: { status: current.status, totals: current.totals, windows: windows?.slice(-5) } }); }
          }
          if (!stopped) subscriber.next({ type: "finished", data: current });
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      };
      void loop();
      return () => { stopped = true; };
    });
  }
}
