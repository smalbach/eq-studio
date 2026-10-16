import { Module } from "@nestjs/common";
import { Scheduler } from "./application/scheduler.ts";
import { ScheduleService } from "./application/schedules.ts";
import { ScheduleRepository } from "./infrastructure/schedule.repository.ts";
import { SchedulesController } from "./presentation/schedules.controller.ts";

@Module({ controllers: [SchedulesController], providers: [ScheduleRepository, ScheduleService, Scheduler] })
export class SchedulesModule {}
