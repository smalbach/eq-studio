import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { parse } from "../../../shared/zod.ts";
import { Requires } from "../../../shared/rbac.ts";
import { Workspace } from "../../../shared/workspace.ts";
import { NotificationService } from "../application/notifications.ts";

const url = z.url({ protocol: /^https?$/ }).max(2000);
const signingSecret = z.string().min(16, "at least 16 characters").max(500).nullable().optional();
const recipients = z.array(z.email()).min(1).max(20);
const common = { name: z.string().min(1).max(200), notifyOn: z.enum(["always", "change"]).default("change"), enabled: z.boolean().default(true) };
const targetInput = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("webhook"), url, signingSecret }),
  z.object({ ...common, kind: z.literal("slack"), url }),
  z.object({ ...common, kind: z.literal("email"), recipients }),
]);
const targetChanges = z.object({ name: common.name.optional(), notifyOn: z.enum(["always", "change"]).optional(), enabled: z.boolean().optional(), url: url.optional(), signingSecret, recipients: recipients.optional() });

/**
 * A project's notification targets. Listing shows only a hint of each URL, so anyone may read
 * it; creating, changing, deleting and testing one is an admin's, like credentials.
 */
@Controller("v1/projects/:project/notifications")
export class NotificationsController {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}

  @Get()
  list(@Workspace() workspaceId: string, @Param("project") project: string) {
    return this.service.list(workspaceId, project);
  }

  @Requires("admin")
  @Post()
  create(@Workspace() workspaceId: string, @Param("project") project: string, @Body() body: unknown) {
    return this.service.create(workspaceId, project, parse(targetInput, body));
  }

  @Requires("admin")
  @Patch(":target")
  update(@Workspace() workspaceId: string, @Param("project") project: string, @Param("target") target: string, @Body() body: unknown) {
    return this.service.update(workspaceId, project, target, parse(targetChanges, body));
  }

  @Requires("admin")
  @Delete(":target")
  @HttpCode(204)
  async remove(@Workspace() workspaceId: string, @Param("project") project: string, @Param("target") target: string) {
    await this.service.remove(workspaceId, project, target);
  }

  /** Sends a sample message now. A failed delivery is the answer (200 with `ok: false`), not an error of this request. */
  @Requires("admin")
  @Post(":target/test")
  @HttpCode(200)
  test(@Workspace() workspaceId: string, @Param("project") project: string, @Param("target") target: string, @Query("locale") locale?: string) {
    return this.service.test(workspaceId, project, target, locale === "en" ? "en" : "es");
  }
}
