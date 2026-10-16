import { Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller.ts";
import { Metrics, RunMetrics } from "./metrics.ts";

@Module({ controllers: [MetricsController], providers: [Metrics, RunMetrics], exports: [Metrics] })
export class MetricsModule {}
