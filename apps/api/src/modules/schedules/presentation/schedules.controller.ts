import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { CurrentActor, Requires, type Actor } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { functionalRun, loadRun, triggeredBy } from "../../runs/presentation/runs.controller.ts";
import { ScheduleService } from "../application/schedules.ts";

const functionalPlan = functionalRun.omit({ environment: true, scope: true });
const loadPlan = loadRun.omit({ environment: true });
const common = { name: z.string().min(1).max(200), environment: z.string().min(1), cron: z.string().min(1).max(120), enabled: z.boolean().default(true) };
const scheduleInput = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("functional"), plan: functionalPlan.default(functionalPlan.parse({ readOnly: true })) }),
  z.object({ ...common, kind: z.literal("load"), plan: loadPlan.default(loadPlan.parse({})) }),
]);
const scheduleChanges = z.object({ name: common.name.optional(), environment: common.environment.optional(), cron: common.cron.optional(), enabled: z.boolean().optional(), plan: z.record(z.string(), z.unknown()).optional() });

/**
 * A project's schedules. Reading them is anyone's; saving one needs the role its run needs when
 * started by hand (editor for read-only runs, admin for writes and load tests).
 */
@Controller("v1/projects/:project/schedules")
export class SchedulesController {
  constructor(@Inject(ScheduleService) private readonly service: ScheduleService) {}

  @Get()
  list(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.service.list(workspaceId, project);
  }

  @Requires("editor")
  @Post()
  create(@CurrentActor() actor: Actor, @Param("project") project: string, @Body() body: unknown) {
    return this.service.create(actor, project, parse(scheduleInput, body), triggeredBy(actor));
  }

  @Requires("editor")
  @Patch(":schedule")
  async update(@CurrentActor() actor: Actor, @Param("project") project: string, @Param("schedule") schedule: string, @Body() body: unknown) {
    const changes = parse(scheduleChanges, body);
    if (changes.plan) {
      const current = await this.service.get(actor.workspaceId, project, schedule);
      changes.plan = current.kind === "functional" ? parse(functionalPlan, changes.plan) : parse(loadPlan, changes.plan);
    }
    return this.service.update(actor, project, schedule, changes);
  }

  @Requires("editor")
  @Delete(":schedule")
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param("project") project: string, @Param("schedule") schedule: string) {
    await this.service.remove(actor, project, schedule);
  }

  /** Starts the schedule's run now, outside its cadence; the next occurrence does not move. */
  @Requires("editor")
  @Post(":schedule/run")
  @HttpCode(202)
  runNow(@CurrentActor() actor: Actor, @Param("project") project: string, @Param("schedule") schedule: string) {
    return this.service.runNow(actor, project, schedule);
  }
}
