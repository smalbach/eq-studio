import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { EventsHandler, type IEventHandler } from "@nestjs/cqrs";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../../config.ts";
import type { EnvironmentRow, NotificationKind, NotificationTargetRow, NotificationTrigger, ProjectRow, RunRow } from "../../../database/entities.ts";
import { Invalid } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { SecretBox } from "../../../shared/secret-box.ts";
import { APP_CONFIG, HTTP_FETCH, SECRET_BOX } from "../../../shared/tokens.ts";
import { EnvironmentRepository } from "../../environments/infrastructure/environment.repository.ts";
import { ProjectRepository } from "../../projects/infrastructure/project.repository.ts";
import { RunFinished } from "../../shared/events.ts";
import { emailMessage, shouldNotify, signature, slackMessage, urlHint, verdictOf, type RunPayload } from "../domain/notification.ts";
import { NotificationRepository } from "../infrastructure/notification.repository.ts";
import { sendMail } from "../infrastructure/smtp.ts";

export type TargetInput = { name: string; kind: NotificationKind; notifyOn: NotificationTrigger; enabled: boolean; url?: string; signingSecret?: string | null; recipients?: string[] };
export type TargetChanges = Partial<Omit<TargetInput, "kind">>;
export type Delivery = { ok: boolean; status: number | null; error: string | null };

const TIMEOUT_MS = 10_000;

/**
 * The project's notification targets, and the delivery of one message to one of them. The URL of
 * a webhook is a secret (whoever has it can post to the channel), so it is encrypted like a
 * credential, never read back, and only its host and last four characters are shown.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(NotificationRepository) private readonly targets: NotificationRepository,
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
    @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(HTTP_FETCH) private readonly fetchImpl: typeof fetch,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get emailAvailable() { return Boolean(this.config.smtp); }

  async list(workspaceId: string, projectId: string) {
    const project = await this.projects.require(workspaceId, projectId);
    return { emailAvailable: this.emailAvailable, targets: (await this.targets.list(project.id)).map(view) };
  }

  async create(workspaceId: string, projectId: string, input: TargetInput) {
    const project = await this.projects.require(workspaceId, projectId);
    const now = isoNow();
    const row: NotificationTargetRow = { id: uuidv7(), workspaceId, projectId: project.id, name: input.name, kind: input.kind, notifyOn: input.notifyOn, enabled: input.enabled, url: null, urlHint: null, signingSecret: null, recipients: null, lastSentAt: null, lastStatus: null, lastError: null, rev: 1, createdAt: now, updatedAt: now };
    this.apply(row, input);
    await this.targets.save(row);
    return view(row);
  }

  async update(workspaceId: string, projectId: string, id: string, changes: TargetChanges) {
    const project = await this.projects.require(workspaceId, projectId);
    const row = await this.targets.require(project.id, id);
    this.apply(row, changes);
    row.rev += 1;
    row.updatedAt = isoNow();
    await this.targets.save(row);
    return view(row);
  }

  async remove(workspaceId: string, projectId: string, id: string) {
    const project = await this.projects.require(workspaceId, projectId);
    await this.targets.delete((await this.targets.require(project.id, id)).id);
  }

  /** Sent without `url`, a target keeps its URL — a form can rename it without asking for it again. */
  private apply(row: NotificationTargetRow, input: TargetChanges) {
    if (input.name !== undefined) row.name = input.name;
    if (input.notifyOn !== undefined) row.notifyOn = input.notifyOn;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    if (row.kind === "email") {
      if (!this.emailAvailable) throw new Invalid("Email needs an SMTP server: set EQ_SMTP_HOST (and EQ_SMTP_FROM, EQ_SMTP_USER, EQ_SMTP_PASSWORD) where the API runs");
      if (input.recipients !== undefined) row.recipients = input.recipients;
      if (!row.recipients?.length) throw new Invalid("An email target needs at least one recipient");
      return;
    }
    if (input.url) { row.url = this.box.encrypt(input.url, `${row.id}:url`); row.urlHint = urlHint(input.url); }
    if (row.kind === "webhook" && input.signingSecret !== undefined) row.signingSecret = input.signingSecret ? this.box.encrypt(input.signingSecret, `${row.id}:signing`) : null;
    if (!row.url) throw new Invalid(`A ${row.kind} target needs a URL`);
  }

  /** A message with sample data, now, and how it went. */
  async test(workspaceId: string, projectId: string, id: string, locale: "es" | "en") {
    const project = await this.projects.require(workspaceId, projectId);
    const row = await this.targets.require(project.id, id);
    const environment = (await this.environments.list(project.id))[0];
    const now = isoNow();
    const payload: RunPayload = {
      event: "run.finished", test: true, sentAt: now,
      project: { id: project.id, slug: project.slug, name: project.name },
      environment: environment ? { id: environment.id, key: environment.key, name: environment.name, baseUrl: environment.baseUrl } : { id: "", key: "example", name: "example", baseUrl: "https://api.example.com" },
      run: { id: "00000000-0000-7000-8000-000000000000", kind: "functional", status: "failed", verdict: "failed", previousVerdict: "passed", changed: true, scope: "GET matrix", totals: { total: 42, completed: 42, passed: 40, failed: 2, blocked: 0 }, error: null, triggeredBy: "test", scheduleId: null, createdAt: now, startedAt: now, finishedAt: now, durationMs: 12_000, url: null },
    };
    return this.deliver(row, payload, locale);
  }

  /** One message to one target. Never throws: the outcome is kept on the target and returned. */
  async deliver(row: NotificationTargetRow, payload: RunPayload, locale: "es" | "en"): Promise<Delivery> {
    let result: Delivery;
    try {
      result = await this.send(row, payload, locale);
    } catch (error) {
      result = { ok: false, status: null, error: error instanceof Error ? (error.name === "TimeoutError" ? `No answer in ${TIMEOUT_MS / 1000} s` : error.message) : String(error) };
    }
    await this.targets.update(row.id, { lastSentAt: isoNow(), lastStatus: result.ok ? "ok" : "failed", lastError: result.error });
    return result;
  }

  private async send(row: NotificationTargetRow, payload: RunPayload, locale: "es" | "en"): Promise<Delivery> {
    if (row.kind === "email") {
      if (!this.config.smtp) return { ok: false, status: null, error: "SMTP is not configured (EQ_SMTP_HOST)" };
      await sendMail(this.config.smtp, { to: row.recipients ?? [], ...emailMessage(payload, locale) });
      return { ok: true, status: null, error: null };
    }
    if (!row.url) return { ok: false, status: null, error: "The target has no URL" };
    const url = this.box.decrypt(row.url, `${row.id}:url`);
    const body = JSON.stringify(row.kind === "slack" ? slackMessage(payload, locale) : payload);
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "EndpointQuality-Notifications/1", "X-EQ-Event": payload.event, "X-EQ-Delivery": randomUUID() };
    if (row.kind === "webhook" && row.signingSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      headers["X-EQ-Timestamp"] = String(timestamp);
      headers["X-EQ-Signature"] = signature(this.box.decrypt(row.signingSecret, `${row.id}:signing`), timestamp, body);
    }
    // Through the SSRF guard in a hosted deployment, like every request to an address a user typed.
    const response = await this.fetchImpl(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok ? { ok: true, status: response.status, error: null } : { ok: false, status: response.status, error: `HTTP ${response.status}` };
  }

  /** The message for a finished run: its verdict, the one before it, and a link to it. */
  async payloadFor(run: RunRow, project: ProjectRow, environment: EnvironmentRow | null): Promise<RunPayload> {
    const previous = await this.targets.previousWithVerdict(run);
    const verdict = verdictOf(run.status);
    const previousVerdict = previous ? verdictOf(previous.status) : null;
    const section = run.kind === "load" ? "carga" : "funcional";
    const url = this.config.publicUrl ? `${this.config.publicUrl}/?vista=${section}&proyecto=${encodeURIComponent(project.slug)}&corrida=${run.id}` : null;
    return {
      event: "run.finished", sentAt: isoNow(),
      project: { id: project.id, slug: project.slug, name: project.name },
      environment: { id: run.environmentId, key: environment?.key ?? "", name: environment?.name ?? "", baseUrl: environment?.baseUrl ?? "" },
      run: { id: run.id, kind: run.kind, status: run.status, verdict, previousVerdict, changed: verdict !== null && verdict !== (previousVerdict ?? "passed"), scope: run.scope, totals: run.totals, error: run.error, triggeredBy: run.triggeredBy, scheduleId: run.triggeredBy.startsWith("schedule:") ? run.triggeredBy.slice(9) : null, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs, url },
    };
  }
}

/**
 * RunFinished ─▶ the project's enabled targets whose filter lets it through.
 *
 * The event is published by the process that executed the run, so with several API processes a
 * run is still announced once. Delivery happens after the run is stored and never delays it.
 */
@EventsHandler(RunFinished)
export class RunFinishedNotifier implements IEventHandler<RunFinished>, BeforeApplicationShutdown {
  private readonly logger = new Logger("Notifications");
  private readonly pending = new Set<Promise<unknown>>();

  constructor(@Inject(NotificationService) private readonly service: NotificationService, @Inject(NotificationRepository) private readonly targets: NotificationRepository, @Inject(ProjectRepository) private readonly projects: ProjectRepository, @Inject(EnvironmentRepository) private readonly environments: EnvironmentRepository) {}

  handle(event: RunFinished) {
    const work = this.notify(event.runId).catch((error) => this.logger.warn(`Notifications for run ${event.runId}: ${(error as Error).message}`));
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** Resolves when every delivery started so far is done. For tests and shutdown. */
  async idle() { while (this.pending.size) await Promise.all([...this.pending]); }

  beforeApplicationShutdown() { return this.idle(); }

  async notify(runId: string) {
    const run = await this.targets.run(runId);
    if (!run) return [];
    const targets = await this.targets.enabled(run.projectId);
    if (!targets.length) return [];
    const project = await this.projects.require(run.workspaceId, run.projectId);
    const environment = await this.environments.require(project.id, run.environmentId).catch(() => null);
    const payload = await this.service.payloadFor(run, project, environment);
    const locale = (run.plan as { locale?: string }).locale === "en" ? "en" : "es";
    const chosen = targets.filter((target) => shouldNotify(target.notifyOn, payload.run.verdict, payload.run.previousVerdict));
    return Promise.all(chosen.map((target) => this.service.deliver(target, payload, locale)));
  }
}

function view(row: NotificationTargetRow) {
  return { id: row.id, name: row.name, kind: row.kind, notifyOn: row.notifyOn, enabled: row.enabled, urlHint: row.urlHint, signed: Boolean(row.signingSecret), recipients: row.recipients, lastSentAt: row.lastSentAt, lastStatus: row.lastStatus, lastError: row.lastError, rev: row.rev, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
