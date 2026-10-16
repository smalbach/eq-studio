import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import { Requires } from "../../shared/rbac.ts";
import { Workspace } from "../../shared/workspace.ts";
import { parse } from "../../shared/zod.ts";
import { AuditLog } from "./audit-log.ts";

const day = /^\d{4}-\d{2}-\d{2}$/;
// A bare date is the whole day: `to=2026-10-16` includes everything on the 16th.
const date = (end: boolean) => z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "an ISO date").transform((value) => day.test(value) ? new Date(Date.parse(`${value}T00:00:00Z`) + (end ? 86_400_000 : 0)).toISOString() : new Date(value).toISOString());
const filter = z.object({
  type: z.string().max(500).optional(),
  from: date(false).optional(),
  to: date(true).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(36).optional(),
});

/** The workspace's audit log: for the people who manage it. */
@Controller("v1/audit")
export class AuditController {
  constructor(@Inject(AuditLog) private readonly audit: AuditLog) {}

  @Requires("admin")
  @Get()
  list(@Workspace() workspaceId: string, @Query() query: unknown) {
    const input = parse(filter, query);
    return this.audit.list(workspaceId, { ...input, types: input.type?.split(",").map((type) => type.trim()).filter(Boolean) });
  }
}
