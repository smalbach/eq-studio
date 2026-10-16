import { Inject, Injectable } from "@nestjs/common";
import type { Role, ScheduleRow } from "../../../database/entities.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { requireRole, type Actor } from "../../../shared/rbac.ts";
import { EnvironmentRepository } from "../../environments/infrastructure/environment.repository.ts";
import { ProjectRepository } from "../../projects/infrastructure/project.repository.ts";
import { nextOccurrence, parseCron } from "../domain/cron.ts";
import { ScheduleRepository } from "../infrastructure/schedule.repository.ts";
import { Scheduler } from "./scheduler.ts";

export type ScheduleInput = { name: string; environment: string; cron: string; enabled: boolean } & ({ kind: "functional"; plan: Record<string, unknown> & { readOnly: boolean } } | { kind: "load"; plan: Record<string, unknown> });
export type ScheduleChanges = Partial<Omit<ScheduleInput, "kind" | "plan">> & { plan?: Record<string, unknown> };

/** The role a schedule needs, the same as starting its run by hand: editors schedule read-only
 * runs; runs that may write and load tests are an admin's. */
export function roleFor(kind: ScheduleRow["kind"], plan: Record<string, unknown>): Role {
  return kind === "functional" && plan.readOnly === true ? "editor" : "admin";
}

/** The schedules of a project: what they run, where, when they fire next and how the last one went. */
@Injectable()
export class ScheduleService {
  constructor(@Inject(ScheduleRepository) private readonly schedules: ScheduleRepository, @Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository, @Inject(Scheduler) private readonly scheduler: Scheduler) {}

  async get(workspaceId: string, projectId: string, id: string) {
    return this.schedules.require((await this.projects.require(workspaceId, projectId)).id, id);
  }

  /** Starts the schedule's run now, outside its cadence; the next occurrence does not move. */
  async runNow(actor: Actor, projectId: string, id: string) {
    const row = await this.get(actor.workspaceId, projectId, id);
    requireRole(actor, roleFor(row.kind, row.plan), "Starting this schedule");
    const runId = await this.scheduler.fire(row);
    return { id: runId, error: runId ? null : (await this.schedules.get(row.id))?.lastError ?? null };
  }

  async list(workspaceId: string, projectId: string) {
    const project = await this.projects.require(workspaceId, projectId);
    const rows = await this.schedules.list(project.id);
    const statuses = await this.schedules.runStatuses(rows.map((row) => row.lastRunId).filter((value): value is string => Boolean(value)));
    return rows.map((row) => view(row, row.lastRunId ? statuses.get(row.lastRunId) ?? null : null));
  }

  async create(actor: Actor, projectId: string, input: ScheduleInput, createdBy: string) {
    requireRole(actor, roleFor(input.kind, input.plan), input.kind === "load" ? "Scheduling a load test" : "Scheduling a run with writes");
    const project = await this.projects.require(actor.workspaceId, projectId);
    const environment = await this.environments.require(project.id, input.environment);
    parseCron(input.cron);
    const now = isoNow();
    const row: ScheduleRow = { id: uuidv7(), workspaceId: actor.workspaceId, projectId: project.id, environmentId: environment.id, name: input.name, cron: input.cron.trim(), kind: input.kind, plan: input.plan, enabled: input.enabled, nextRunAt: input.enabled ? nextOccurrence(input.cron, new Date()).toISOString() : null, lastRunAt: null, lastRunId: null, lastError: null, createdBy, rev: 1, createdAt: now, updatedAt: now };
    await this.schedules.save(row);
    return view(row, null);
  }

  async update(actor: Actor, projectId: string, id: string, changes: ScheduleChanges) {
    const project = await this.projects.require(actor.workspaceId, projectId);
    const row = await this.schedules.require(project.id, id);
    requireRole(actor, roleFor(row.kind, row.plan), "Changing this schedule");
    if (changes.plan) requireRole(actor, roleFor(row.kind, changes.plan), "Scheduling a run with writes");
    if (changes.environment) row.environmentId = (await this.environments.require(project.id, changes.environment)).id;
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.plan) row.plan = changes.plan;
    if (changes.cron !== undefined) { parseCron(changes.cron); row.cron = changes.cron.trim(); }
    if (changes.enabled !== undefined) row.enabled = changes.enabled;
    // A new expression, or turning it back on, counts from now: no burst of missed occurrences.
    if (changes.cron !== undefined || changes.enabled !== undefined) { row.nextRunAt = row.enabled ? nextOccurrence(row.cron, new Date()).toISOString() : null; row.lastError = null; }
    row.rev += 1;
    row.updatedAt = isoNow();
    await this.schedules.save(row);
    const statuses = await this.schedules.runStatuses(row.lastRunId ? [row.lastRunId] : []);
    return view(row, row.lastRunId ? statuses.get(row.lastRunId) ?? null : null);
  }

  async remove(actor: Actor, projectId: string, id: string) {
    const project = await this.projects.require(actor.workspaceId, projectId);
    const row = await this.schedules.require(project.id, id);
    requireRole(actor, roleFor(row.kind, row.plan), "Deleting this schedule");
    await this.schedules.delete(row.id);
  }
}

function view(row: ScheduleRow, lastRunStatus: string | null) {
  return { id: row.id, name: row.name, environmentId: row.environmentId, cron: row.cron, kind: row.kind, plan: row.plan, enabled: row.enabled, nextRunAt: row.nextRunAt, lastRunAt: row.lastRunAt, lastRunId: row.lastRunId, lastRunStatus, lastError: row.lastError, rev: row.rev, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
