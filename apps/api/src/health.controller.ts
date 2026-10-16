import { Controller, Get, Inject } from "@nestjs/common";
import type { DataSource } from "typeorm";
import type { AppConfig } from "./config.ts";
import { APP_CONFIG, DATA_SOURCE } from "./shared/tokens.ts";
import { Public } from "./shared/rbac.ts";

@Controller()
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(DATA_SOURCE) private readonly db: DataSource) {}

  @Public()
  @Get("health")
  async health() {
    await this.db.query("SELECT 1");
    return { status: "ok", mode: this.config.mode, database: this.config.database.type, auth: this.config.auth?.required ? "required" : "none", registration: this.config.auth?.registration ?? "invite" };
  }
}
