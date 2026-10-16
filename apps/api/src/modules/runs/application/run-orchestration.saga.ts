import { Injectable } from "@nestjs/common";
import { ofType, Saga, type IEvent } from "@nestjs/cqrs";
import { map, type Observable } from "rxjs";
import { RunQueued } from "../../shared/events.ts";
import { EnqueueRunCommand } from "./commands/run-control.ts";

/**
 * StartRun ─▶ RunQueued ─▶ EnqueueRun ─▶ queue ─▶ RunExecutor ─▶ RunStarted … RunCaseFinished … RunFinished
 *
 * The command that plans a run does not know how it is executed: this saga connects the two, so
 * a different execution path (a scheduled run, a run from CI) only needs to publish the event.
 */
@Injectable()
export class RunOrchestrationSaga {
  @Saga()
  queued = (events$: Observable<IEvent>) => events$.pipe(ofType(RunQueued), map((event) => new EnqueueRunCommand(event.runId)));
}
