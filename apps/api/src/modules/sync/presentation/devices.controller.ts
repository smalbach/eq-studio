import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { z } from "zod";
import { RateLimiter } from "../../../shared/rate-limit.ts";
import { AccountOnly, CurrentActor, CurrentUser, Public, Requires, type Actor } from "../../../shared/rbac.ts";
import { parse } from "../../../shared/zod.ts";
import { CollectDeviceTokenCommand, DecideDeviceCommand, DescribeDeviceQuery, ForgetDeviceCommand, StartDeviceCommand } from "../application/devices.ts";

type Request = { ip?: string; protocol: string; get(name: string): string | undefined };
type Response = { status(code: number): unknown };

const start = z.object({ name: z.string().min(1).max(200) });
const collect = z.object({ deviceCode: z.string().min(10).max(200) });
const approve = z.object({ workspaceId: z.string().min(1).max(64) });

/**
 * Signing in a device from the browser: the device starts, a signed-in person approves it at
 * the URL it shows, the device collects its token.
 */
@Controller("v1/auth/device")
export class DevicesController {
  constructor(@Inject(CommandBus) private readonly commands: CommandBus, @Inject(QueryBus) private readonly queries: QueryBus, @Inject(RateLimiter) private readonly limiter: RateLimiter) {}

  @Public()
  @Post()
  start(@Req() request: Request, @Body() body: unknown) {
    this.limiter.check(`device:${request.ip}`, 10);
    return this.commands.execute(new StartDeviceCommand(parse(start, body).name, `${request.protocol}://${request.get("host")}`));
  }

  /** 200 with the token once approved, 202 while pending, 410 once expired, denied or used. */
  @Public()
  @Post("token")
  async token(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    this.limiter.check(`device-token:${request.ip}`, 120);
    const answer = await this.commands.execute(new CollectDeviceTokenCommand(parse(collect, body).deviceCode));
    response.status(answer.status === "approved" ? 200 : answer.status === "pending" ? 202 : 410);
    return answer;
  }

  @Requires("viewer")
  @Delete("self")
  @HttpCode(204)
  async forget(@CurrentActor() actor: Actor) {
    await this.commands.execute(new ForgetDeviceCommand(actor));
  }

  @AccountOnly()
  @Get(":code")
  describe(@Param("code") code: string) {
    return this.queries.execute(new DescribeDeviceQuery(code));
  }

  @AccountOnly()
  @Post(":code/approve")
  @HttpCode(204)
  async approve(@CurrentUser() userId: string, @Param("code") code: string, @Body() body: unknown) {
    await this.commands.execute(new DecideDeviceCommand(userId, code, true, parse(approve, body).workspaceId));
  }

  @AccountOnly()
  @Post(":code/deny")
  @HttpCode(204)
  async deny(@CurrentUser() userId: string, @Param("code") code: string) {
    await this.commands.execute(new DecideDeviceCommand(userId, code, false));
  }
}
