import { Module } from "@nestjs/common";
import type { AppConfig } from "../../config.ts";
import { APP_CONFIG, RUN_QUEUE } from "../../shared/tokens.ts";
import { CredentialResolver } from "../credentials/application/credential-resolver.ts";
import { CancelRunHandler, DeleteRunHandler, EnqueueRunHandler, ReplayRunHandler } from "./application/commands/run-control.ts";
import { ProbeHandler } from "./application/commands/probe.ts";
import { StartLoadRunHandler, StartRunHandler } from "./application/commands/start-run.ts";
import { GetRunHandler, ListRunsHandler } from "./application/queries/run-queries.ts";
import { RunReportHandler } from "./application/queries/run-report.ts";
import { RunContextLoader } from "./application/run-context.ts";
import { RunExecutor } from "./application/run-executor.ts";
import { RunOrchestrationSaga } from "./application/run-orchestration.saga.ts";
import { RunStream } from "./application/run-stream.ts";
import { RunWorker } from "./application/run-worker.ts";
import { BullMqRunQueue } from "./infrastructure/bullmq-run-queue.ts";
import { InMemoryRunQueue } from "./infrastructure/run-queue.ts";
import { RunRepository } from "./infrastructure/run.repository.ts";
import { RunsController } from "./presentation/runs.controller.ts";

@Module({
  controllers: [RunsController],
  providers: [
    RunRepository, CredentialResolver, RunContextLoader, RunExecutor, RunStream, RunWorker, RunOrchestrationSaga,
    StartRunHandler, StartLoadRunHandler, EnqueueRunHandler, CancelRunHandler, DeleteRunHandler, ReplayRunHandler, ProbeHandler, ListRunsHandler, GetRunHandler, RunReportHandler,
    { provide: RUN_QUEUE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.queue.driver === "redis" ? new BullMqRunQueue(config.queue.url, config.queue.concurrency) : new InMemoryRunQueue(config.queue.concurrency) },
  ],
  exports: [RUN_QUEUE],
})
export class RunsModule {}
