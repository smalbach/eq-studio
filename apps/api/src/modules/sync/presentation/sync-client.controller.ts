import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Requires } from "../../../shared/rbac.ts";
import { parse } from "../../../shared/zod.ts";
import { SyncClient } from "../application/sync-client.ts";

const link = z.object({ url: z.string().min(1).max(2000), token: z.string().min(10).max(500).optional(), deviceName: z.string().min(1).max(200).optional() });
const settings = z.object({ includeRuns: z.boolean().optional(), projects: z.array(z.string().max(64)).max(1000).nullable().optional(), passphrase: z.string().max(1000).nullable().optional() });
const resolve = z.object({ choice: z.enum(["mine", "theirs"]) });

/** This installation's link to a cloud workspace (local mode). */
@Controller("v1/sync")
export class SyncClientController {
  constructor(@Inject(SyncClient) private readonly sync: SyncClient) {}

  @Get()
  status() { return this.sync.status(); }

  @Requires("admin")
  @Post("link")
  link(@Body() body: unknown) { return this.sync.link(parse(link, body)); }

  /** Asks the cloud now whether the browser approved this device (it is also asked every few seconds). */
  @Requires("admin")
  @Post("link/check")
  @HttpCode(200)
  async check() { await this.sync.checkDevice(); return this.sync.status(); }

  @Requires("admin")
  @Delete("link")
  @HttpCode(204)
  async unlink() { await this.sync.unlink(); }

  @Requires("admin")
  @Patch()
  configure(@Body() body: unknown) { return this.sync.configure(parse(settings, body)); }

  @Requires("admin")
  @Post("run")
  @HttpCode(200)
  run() { return this.sync.sync(); }

  @Get("conflicts")
  conflicts() { return this.sync.conflicts(); }

  @Requires("admin")
  @Post("conflicts/:id/resolve")
  @HttpCode(204)
  async resolve(@Param("id") id: string, @Body() body: unknown) { await this.sync.resolve(id, parse(resolve, body).choice); }
}
