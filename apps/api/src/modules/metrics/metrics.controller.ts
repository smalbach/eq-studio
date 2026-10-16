import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config.ts";
import { sha256 } from "../../shared/auth-crypto.ts";
import { NotFound, Unauthorized } from "../../shared/errors.ts";
import { Public } from "../../shared/rbac.ts";
import { APP_CONFIG } from "../../shared/tokens.ts";
import { Metrics } from "./metrics.ts";

type Request = { headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; send(body: string): void };

/**
 * `GET /metrics` for Prometheus. Absent (404) unless `EQ_METRICS=true`; with `EQ_METRICS_TOKEN`
 * it also needs `Authorization: Bearer <token>`. It is not behind the sign-in: a scraper has no
 * account, and the numbers carry no workspace's data.
 */
@Controller("metrics")
export class MetricsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(Metrics) private readonly metrics: Metrics) {}

  @Public()
  @Get()
  async scrape(@Req() request: Request, @Res() response: Response) {
    if (!this.config.metrics?.enabled) throw new NotFound("Route");
    const expected = this.config.metrics.token;
    if (expected) {
      const header = request.headers.authorization;
      const value = (Array.isArray(header) ? header[0] : header) ?? "";
      const given = value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
      // Hashes of equal length, so the comparison takes the same time whatever was sent.
      if (!timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(sha256(expected)))) throw new Unauthorized("The metrics need their bearer token (EQ_METRICS_TOKEN)");
    }
    response.setHeader("Content-Type", this.metrics.contentType);
    response.send(await this.metrics.text());
  }
}
