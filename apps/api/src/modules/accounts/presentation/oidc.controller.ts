import { Controller, Get, Inject, Logger, Req, Res } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { AppConfig } from "../../../config.ts";
import { NotFound } from "../../../shared/errors.ts";
import { RateLimiter } from "../../../shared/rate-limit.ts";
import { Public } from "../../../shared/rbac.ts";
import { APP_CONFIG } from "../../../shared/tokens.ts";
import type { Session } from "../application/accounts-commands.ts";
import { OidcClient, SsoRefused, SsoSignInCommand } from "../application/oidc.ts";
import { COOKIE, cookieOf, cookieOptions, type Request as AuthRequest } from "./auth.controller.ts";

type Request = AuthRequest & { originalUrl: string };
type Response = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void; redirect(status: number, url: string): void };

/** The flow's cookie: `lax`, because the provider sends the browser back with a cross-site redirect. */
const FLOW_COOKIE = "eq_oidc";
const flowOptions = (request: Request) => ({ ...cookieOptions(request), sameSite: "lax", path: "/v1/auth/oidc" });

/**
 * `GET /v1/auth/oidc/start` sends the browser to the provider; it comes back to
 * `/v1/auth/oidc/callback`, which signs in (the refresh cookie, as a password sign-in sets it)
 * and returns to the app. A refusal returns to the app too, with `?sso_error=<code>`.
 */
@Controller("v1/auth/oidc")
export class OidcController {
  private readonly logger = new Logger("OIDC");

  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(OidcClient) private readonly oidc: OidcClient, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(RateLimiter) private readonly limiter: RateLimiter) {}

  private get app() { return this.config.publicUrl!; }
  private get page() { return `${this.app}/app/`; }

  @Public()
  @Get("start")
  async start(@Req() request: Request, @Res() response: Response) {
    if (!this.oidc.settings) throw new NotFound("Single sign-on");
    this.limiter.check(`oidc:${request.ip}`, 20);
    try {
      const { url, cookie } = await this.oidc.start();
      response.cookie(FLOW_COOKIE, cookie, { ...flowOptions(request), maxAge: 10 * 60_000 });
      response.redirect(302, url);
    } catch (error) {
      this.logger.error(`The provider could not be reached: ${error instanceof Error ? error.message : String(error)}`);
      response.redirect(302, `${this.page}?sso_error=failed`);
    }
  }

  @Public()
  @Get("callback")
  async callback(@Req() request: Request, @Res() response: Response) {
    if (!this.oidc.settings) throw new NotFound("Single sign-on");
    this.limiter.check(`oidc:${request.ip}`, 20);
    const flow = this.oidc.open(cookieOf(request, FLOW_COOKIE));
    response.clearCookie(FLOW_COOKIE, flowOptions(request));
    if (!flow) { response.redirect(302, `${this.page}?sso_error=expired`); return; }
    try {
      // The URL the provider redirected to, rebuilt on the configured address (it must match the registered redirect URI).
      const claims = await this.oidc.finish(new URL(request.originalUrl, this.app), flow);
      const session: Session = await this.commands.execute(new SsoSignInCommand(claims.email, claims.verified, claims.name));
      response.cookie(COOKIE, session.refreshToken, { ...cookieOptions(request), maxAge: this.config.auth!.refreshTtlDays * 86_400_000 });
      response.redirect(302, this.page);
    } catch (error) {
      if (!(error instanceof SsoRefused)) this.logger.warn(`Single sign-on failed: ${error instanceof Error ? error.message : String(error)}`);
      response.redirect(302, `${this.page}?sso_error=${error instanceof SsoRefused ? error.code : "failed"}`);
    }
  }
}
