import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { CqrsModule } from "@nestjs/cqrs";
import type { AppConfig } from "./config.ts";
import { DatabaseModule } from "./database/database.module.ts";
import { HealthController } from "./health.controller.ts";
import { ExamplesController } from "./modules/examples/examples.controller.ts";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ProjectConfigModule } from "./modules/config/project-config.module.ts";
import { EnvironmentsModule } from "./modules/environments/environments.module.ts";
import { ProjectsModule } from "./modules/projects/projects.module.ts";
import { PersistenceModule } from "./modules/shared/persistence.module.ts";
import { SpecsModule } from "./modules/specs/specs.module.ts";
import { CredentialsModule } from "./modules/credentials/credentials.module.ts";
import { RunsModule } from "./modules/runs/runs.module.ts";
import { AccountsModule } from "./modules/accounts/accounts.module.ts";
import { SyncModule } from "./modules/sync/sync.module.ts";
import { SchedulesModule } from "./modules/schedules/schedules.module.ts";
import { NotificationsModule } from "./modules/notifications/notifications.module.ts";
import { AuthGuard } from "./shared/auth.guard.ts";
import { APP_GUARD } from "@nestjs/core";
import { ProblemDetailsFilter } from "./shared/problem.filter.ts";
import { APP_CONFIG, SPEC_FETCHER } from "./shared/tokens.ts";
import type { SpecFetcher } from "./modules/specs/infrastructure/spec-fetcher.ts";

@Module({})
class ConfigHolder {
  static of(config: AppConfig): DynamicModule {
    return { module: ConfigHolder, global: true, providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] };
  }
}

/** The application, built the same way by `main.ts` and by the tests. `specFetcher` replaces the
 * HTTP fetcher (a test can serve documents without a network). */
export async function createApp(config: AppConfig, overrides: { specFetcher?: SpecFetcher } = {}) {
  @Module({
    imports: [ConfigHolder.of(config), CqrsModule.forRoot(), DatabaseModule, PersistenceModule, ProjectsModule, SpecsModule, EnvironmentsModule, ProjectConfigModule, CredentialsModule, RunsModule, AccountsModule, SchedulesModule, NotificationsModule, SyncModule.forMode(config.mode)],
    controllers: [HealthController, ExamplesController],
    providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  })
  class AppModule {}

  const builder = NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.EQ_LOG === "debug" ? ["log", "error", "warn", "debug"] : process.env.EQ_LOG === "silent" ? false : ["error", "warn"], bodyParser: false });
  const app = await builder;
  if (overrides.specFetcher) {
    // Replaced on the shared instance after creation: no testing module needed.
    const fetcher = app.get<SpecFetcher>(SPEC_FETCHER);
    Object.assign(fetcher, { fetch: overrides.specFetcher.fetch.bind(overrides.specFetcher) });
  }
  app.useBodyParser("json", { limit: "6mb" });
  app.use(securityHeaders);
  if (config.network?.trustProxy) app.set("trust proxy", /^\d+$/.test(config.network.trustProxy) ? Number(config.network.trustProxy) : config.network.trustProxy);
  if (config.network?.corsOrigins.length) app.enableCors({ origin: config.network.corsOrigins, credentials: true });
  serveWebApp(app, config.webDir);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}

/**
 * The built web app from the same origin as the API: one process, one port, no CORS. Any GET
 * that is not the API falls back to `index.html`, so the SPA's own routes reload correctly.
 */
function serveWebApp(app: NestExpressApplication, directory: string | undefined) {
  const index = directory ? join(directory, "index.html") : "";
  if (!directory || !existsSync(index)) return;
  app.useStaticAssets(directory, { index: false, maxAge: "1h" });
  const html = readFileSync(index, "utf8");
  // The app's only inline script (the theme, before the first paint) is allowed by its hash.
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`);
  const policy = ["default-src 'self'", `script-src 'self' ${inline.join(" ")}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join("; ");
  app.use((request: { method: string; path: string }, response: { setHeader(name: string, value: string): void; type(value: string): { send(body: string): void } }, next: () => void) => {
    if (request.method !== "GET" || request.path.startsWith("/v1/") || request.path === "/health") return next();
    response.setHeader("Content-Security-Policy", policy);
    response.type("html").send(html);
  });
}

/** Headers every response carries: no sniffing, no framing, no referrer leaking a run's URL. */
function securityHeaders(request: { headers: Record<string, string | string[] | undefined>; secure?: boolean }, response: { setHeader(name: string, value: string): void }, next: () => void) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (request.secure || request.headers["x-forwarded-proto"] === "https") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
