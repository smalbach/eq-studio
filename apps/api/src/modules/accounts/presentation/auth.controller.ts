import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { Unauthorized } from "../../../shared/errors.ts";
import { RateLimiter } from "../../../shared/rate-limit.ts";
import { AccountOnly, CurrentUser, Public } from "../../../shared/rbac.ts";
import { parse } from "../../../shared/zod.ts";
import { AcceptInvitationCommand, ChangePasswordCommand, CreateWorkspaceCommand, LoginCommand, LogoutCommand, RefreshCommand, RegisterCommand, type Session } from "../application/accounts-commands.ts";
import { MeQuery } from "../application/accounts-queries.ts";
import { RequestPasswordResetCommand, ResetPasswordCommand } from "../application/password-reset.ts";

export type Request = { ip?: string; headers: Record<string, string | string[] | undefined>; secure?: boolean };
type Response = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void };

const email = z.email().max(320);
const password = z.string().min(1).max(200);
const register = z.object({ email, password, name: z.string().min(1).max(200), workspace: z.string().min(1).max(200).optional() });
const login = z.object({ email, password });
const refresh = z.object({ refreshToken: z.string().optional(), workspace: z.string().optional() });
const accept = z.object({ token: z.string().min(10), password, name: z.string().min(1).max(200).optional() });
const changePassword = z.object({ current: password, next: password });
const workspace = z.object({ name: z.string().min(1).max(200) });
const forgot = z.object({ email });
const reset = z.object({ token: z.string().min(10).max(200), password });

/**
 * The refresh token also travels as an httpOnly cookie, scoped to these routes: the browser app
 * keeps only the short access token in memory, and script cannot read the long-lived one. The
 * CLI and other clients use the token in the body.
 */
export const COOKIE = "eq_refresh";
export const cookieOptions = (request: Request) => ({ httpOnly: true, sameSite: "strict", secure: Boolean(request.secure) || request.headers["x-forwarded-proto"] === "https", path: "/v1/auth" });

export function cookieOf(request: Request, name = COOKIE) {
  const header = request.headers.cookie;
  const value = Array.isArray(header) ? header.join(";") : header ?? "";
  return value.split(";").map((part) => part.trim().split("=")).find(([key]) => key === name)?.[1];
}

@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus, @Inject(RateLimiter) private readonly limiter: RateLimiter) {}

  private answer(session: Session, request: Request, response: Response) {
    response.cookie(COOKIE, session.refreshToken, { ...cookieOptions(request), maxAge: 30 * 86_400_000 });
    return session;
  }

  @Public()
  @Post("register")
  async register(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.limiter.check(`register:${request.ip}`, 5);
    return this.answer(await this.commands.execute(new RegisterCommand(parse(register, body))), request, response);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const input = parse(login, body);
    this.limiter.check(`login:${request.ip}`, 10);
    this.limiter.check(`login:${input.email.toLowerCase()}`, 10);
    return this.answer(await this.commands.execute(new LoginCommand(input.email, input.password)), request, response);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.limiter.check(`refresh:${request.ip}`, 60);
    const input = parse(refresh, body ?? {});
    const token = input.refreshToken ?? cookieOf(request);
    if (!token) throw new Unauthorized("Sign in again");
    return this.answer(await this.commands.execute(new RefreshCommand(token, input.workspace)), request, response);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    const token = parse(refresh, body ?? {}).refreshToken ?? cookieOf(request);
    if (token) await this.commands.execute(new LogoutCommand(token));
    response.clearCookie(COOKIE, cookieOptions(request));
  }

  @Public()
  @Post("accept-invitation")
  async accept(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.limiter.check(`accept:${request.ip}`, 10);
    const input = parse(accept, body);
    return this.answer(await this.commands.execute(new AcceptInvitationCommand(input.token, input.password, input.name)), request, response);
  }

  /** Always 202, whether the email has an account or not. */
  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  async forgot(@Req() request: Request, @Body() body: unknown) {
    const input = parse(forgot, body);
    this.limiter.check(`forgot:${request.ip}`, 5);
    // Per address too, counted the same for unknown emails: the limit reveals nothing.
    this.limiter.check(`forgot:${input.email.toLowerCase()}`, 3, 15 * 60_000);
    await this.commands.execute(new RequestPasswordResetCommand(input.email));
    return { status: "accepted" };
  }

  @Public()
  @Post("password/reset")
  @HttpCode(204)
  async reset(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.limiter.check(`reset:${request.ip}`, 10);
    const input = parse(reset, body);
    await this.commands.execute(new ResetPasswordCommand(input.token, input.password));
    // Every session of the account was closed, this browser's included.
    response.clearCookie(COOKIE, cookieOptions(request));
  }

  @AccountOnly()
  @Get("me")
  me(@CurrentUser() userId: string) {
    return this.queries.execute(new MeQuery(userId));
  }

  @AccountOnly()
  @Post("password")
  @HttpCode(204)
  async changePassword(@CurrentUser() userId: string, @Body() body: unknown) {
    const input = parse(changePassword, body);
    await this.commands.execute(new ChangePasswordCommand(userId, input.current, input.next));
  }

  @AccountOnly()
  @Post("workspaces")
  createWorkspace(@CurrentUser() userId: string, @Body() body: unknown) {
    return this.commands.execute(new CreateWorkspaceCommand(userId, parse(workspace, body).name));
  }
}
