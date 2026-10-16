import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res, Sse, type MessageEvent } from "@nestjs/common";
import { REPORT_FORMATS } from "@eq/runner-core/report";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ORDER_MODES } from "@eq/runner-core";
import { Observable } from "rxjs";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { CurrentActor, Requires, type Actor } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { CancelRunCommand, DeleteRunCommand, ReplayRunCommand } from "../application/commands/run-control.ts";
import { ProbeCommand } from "../application/commands/probe.ts";
import { StartLoadRunCommand, StartRunCommand } from "../application/commands/start-run.ts";
import { GetRunQuery, ListRunsQuery } from "../application/queries/run-queries.ts";
import { RunReportQuery } from "../application/queries/run-report.ts";
import { RunStream } from "../application/run-stream.ts";

type Response = { setHeader(name: string, value: string): void };

const locale = z.enum(["es", "en"]).default("es");
export const functionalRun = z.object({
  environment: z.string().min(1),
  scope: z.string().max(300).optional(),
  mode: z.enum(ORDER_MODES as ["contract", "safe", "custom"]).default("safe"),
  customOrder: z.array(z.string()).default([]),
  endpointIds: z.array(z.string()).min(1).optional(),
  caseSelection: z.record(z.string(), z.array(z.string())).default({}),
  readOnly: z.boolean().default(false),
  authEnabled: z.boolean().optional(),
  samples: z.number().int().min(1).max(50).default(1),
  delayMs: z.number().int().min(0).max(60_000).default(0),
  locale,
});
export const loadRun = z.object({
  environment: z.string().min(1),
  type: z.enum(["load", "stress", "spike", "soak"]).default("load"),
  baseRps: z.number().positive().max(500).default(10),
  peakRps: z.number().positive().max(500).optional(),
  durationS: z.number().int().min(1).max(1800).default(30),
  mixId: z.string().optional(),
  targets: z.array(z.object({ label: z.string(), method: z.literal("GET").default("GET"), path: z.string().startsWith("/"), weight: z.number().min(0) })).max(30).optional(),
  data: z.record(z.string(), z.array(z.string())).optional(),
  maxInFlight: z.number().int().min(1).max(512).default(256),
  timeoutMs: z.number().int().min(100).max(60_000).default(5000),
  latency: z.object({ mode: z.enum(["project", "custom", "off"]), p95Ms: z.number().positive().optional() }).default({ mode: "project" }),
  onPreflightFailure: z.enum(["stop", "skip", "ignore"]).default("skip"),
  locale,
});
const probe = z.object({ environment: z.string().min(1), operationId: z.string().min(1), scenarioId: z.string().min(1), parameters: z.record(z.string(), z.string()).optional(), body: z.unknown().optional(), samples: z.number().int().min(1).max(50).default(1), locale });
const reportQuery = z.object({ format: z.enum(REPORT_FORMATS).default("html"), locale: z.enum(["es", "en"]).default("en"), download: z.enum(["true", "false"]).default("true") });
const listQuery = z.object({ kind: z.enum(["functional", "load"]).optional(), limit: z.coerce.number().int().optional(), full: z.enum(["true", "false"]).optional() });

/** Who started a run, as the history shows it. */
export const triggeredBy = (actor: Actor) => actor.local ? "local" : actor.userId ? `user:${actor.userId}` : `token:${actor.tokenId}`;

@Controller("v1")
export class RunsController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus, @Inject(RunStream) private readonly stream: RunStream) {}

  /** Editors start read-only runs; a run that may write needs an admin (checked by the command). */
  @Requires("editor")
  @Post("projects/:project/runs")
  @HttpCode(202)
  start(@CurrentActor() actor: Actor, @Param("project") project: string, @Body() body: unknown) {
    const { environment, scope, ...plan } = parse(functionalRun, body);
    return this.commands.execute(new StartRunCommand(actor.workspaceId, project, environment, plan, scope, triggeredBy(actor), actor));
  }

  @Requires("admin")
  @Post("projects/:project/load-runs")
  @HttpCode(202)
  startLoad(@CurrentActor() actor: Actor, @Param("project") project: string, @Body() body: unknown) {
    const { environment, ...plan } = parse(loadRun, body);
    return this.commands.execute(new StartLoadRunCommand(actor.workspaceId, project, environment, { ...plan, peakRps: plan.peakRps ?? plan.baseRps }, triggeredBy(actor)));
  }

  /** One case with the given values, not stored. Answers with its steps. */
  @Requires("editor")
  @Post("projects/:project/probe")
  @HttpCode(200)
  probe(@CurrentActor() actor: Actor, @Param("project") project: string, @Body() body: unknown) {
    return this.commands.execute(new ProbeCommand(actor.workspaceId, project, parse(probe, body), actor));
  }

  @Get("projects/:project/runs")
  list(@Workspace() workspaceId: string, @Param("project") project: string, @Query() query: unknown) {
    const input = parse(listQuery, query);
    return this.queries.execute(new ListRunsQuery(workspaceId, project, input.kind, input.limit, input.full === "true"));
  }

  @Get("runs/:run")
  get(@Workspace() workspaceId: string, @Param("run") run: string, @Query("steps") steps?: string) {
    return this.queries.execute(new GetRunQuery(workspaceId, run, steps === "true"));
  }

  /** The run as a shareable file: `html` (self-contained page), `sarif` (code scanning) or
   * `junit`. Secrets are masked; `download=false` shows it inline instead of saving it. */
  @Get("runs/:run/report")
  async report(@Workspace() workspaceId: string, @Param("run") run: string, @Query() query: unknown, @Res({ passthrough: true }) response: Response) {
    const { format, locale, download } = parse(reportQuery, query);
    const report = await this.queries.execute<RunReportQuery, { body: string; contentType: string; filename: string }>(new RunReportQuery(workspaceId, run, format, locale));
    response.setHeader("Content-Type", report.contentType);
    response.setHeader("Content-Disposition", `${download === "true" ? "attachment" : "inline"}; filename="${report.filename.replace(/[^\w.-]/g, "_")}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    // The page carries its own CSP (no requests at all); this one applies when it is served.
    if (format === "html") response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
    return report.body;
  }

  @Requires("admin")
  @Delete("runs/:run")
  @HttpCode(204)
  async remove(@Workspace() workspaceId: string, @Param("run") run: string) {
    await this.commands.execute(new DeleteRunCommand(workspaceId, run));
  }

  @Requires("editor")
  @Post("runs/:run/cancel")
  @HttpCode(202)
  async cancel(@Workspace() workspaceId: string, @Param("run") run: string) {
    await this.commands.execute(new CancelRunCommand(workspaceId, run));
    return { status: "cancelling" };
  }

  @Requires("editor")
  @Post("runs/:run/replay")
  @HttpCode(202)
  replay(@CurrentActor() actor: Actor, @Param("run") run: string) {
    return this.commands.execute(new ReplayRunCommand(actor.workspaceId, run, triggeredBy(actor), actor));
  }

  /** Server-sent events: a snapshot, then every change, until the run finishes. */
  @Sse("runs/:run/stream")
  events(@Workspace() workspaceId: string, @Param("run") run: string): Observable<MessageEvent> {
    return this.stream.follow(workspaceId, run);
  }
}
