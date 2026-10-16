/**
 * The audit log: security-relevant events, per workspace, append-only.
 *
 * What is written is who (a person's email, or an API token's name), what, to which target, from
 * which address, and a few non-secret details — never a password, a token or a credential's
 * value. Recording never fails the action it records: a log that cannot be written is reported
 * in the server's log, and the action stands.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Brackets, type DataSource } from "typeorm";
import { AuditEventEntity, type AuditEventRow } from "../../database/entities.ts";
import { uuidv7, isoNow } from "../../shared/ids.ts";
import { requestContext } from "../../shared/request-context.ts";
import type { Actor } from "../../shared/rbac.ts";
import { DATA_SOURCE } from "../../shared/tokens.ts";
import { AccountsRepository } from "../accounts/infrastructure/accounts.repository.ts";

export const AUDIT_TYPES = [
  "auth.sign_in.succeeded", "auth.sign_in.failed", "auth.password.changed", "auth.password.reset", "auth.password.reset_link_created",
  "member.invited", "member.joined", "member.removed", "member.role_changed",
  "api_token.created", "api_token.revoked",
  "credential.created", "credential.updated", "credential.deleted",
  "project.deleted",
  "device.linked", "device.unlinked",
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

/** Who acted: a request's actor, or just the user (sign-in, accounts without a workspace role). */
export type AuditActor = Pick<Actor, "userId" | "tokenId"> | { userId: string; tokenId?: null } | null;
export type AuditTarget = { type: string; id?: string | null; label?: string | null };
export type AuditEntry = { workspaceId: string | string[]; type: AuditType; actor?: AuditActor; target?: AuditTarget; detail?: Record<string, unknown> };
export type AuditFilter = { types?: string[]; from?: string; to?: string; limit: number; cursor?: string };

@Injectable()
export class AuditLog {
  private readonly logger = new Logger("Audit");

  constructor(@Inject(DATA_SOURCE) private readonly db: DataSource, @Inject(AccountsRepository) private readonly accounts: AccountsRepository) {}

  async record({ workspaceId, type, actor, target, detail }: AuditEntry) {
    try {
      const workspaces = [...new Set(Array.isArray(workspaceId) ? workspaceId : [workspaceId])];
      if (!workspaces.length) return;
      const context = requestContext();
      const label = await this.label(actor ?? null);
      const now = isoNow();
      const rows: AuditEventRow[] = workspaces.map((workspace) => ({
        id: uuidv7(), workspaceId: workspace, type,
        actorUserId: actor?.userId ?? null, actorTokenId: actor?.tokenId ?? null, actorLabel: label,
        targetType: target?.type ?? null, targetId: target?.id ?? null, targetLabel: target?.label?.slice(0, 320) ?? null,
        detail: detail ?? null, ip: context?.ip?.slice(0, 64) ?? null, createdAt: now,
      }));
      await this.db.getRepository(AuditEventEntity).save(rows);
    } catch (error) {
      this.logger.error(`Could not write the audit event ${type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async label(actor: AuditActor) {
    if (!actor) return null;
    if (actor.tokenId) return (await this.accounts.apiTokenById(actor.tokenId))?.name ?? null;
    if (actor.userId) return (await this.accounts.userById(actor.userId))?.email ?? null;
    return null;
  }

  /** Newest first, a page at a time: `cursor` is the last id of the previous page. */
  async list(workspaceId: string, filter: AuditFilter) {
    const query = this.db.getRepository(AuditEventEntity).createQueryBuilder("event").where("event.workspaceId = :workspaceId", { workspaceId });
    if (filter.types?.length) {
      query.andWhere(new Brackets((inner) => filter.types!.forEach((type, index) => {
        // `auth.` (a trailing dot) is every type under it.
        if (type.endsWith(".")) inner.orWhere(`event.type LIKE :type${index}`, { [`type${index}`]: `${type.replace(/[%_]/g, "")}%` });
        else inner.orWhere(`event.type = :type${index}`, { [`type${index}`]: type });
      })));
    }
    if (filter.from) query.andWhere("event.createdAt >= :from", { from: filter.from });
    if (filter.to) query.andWhere("event.createdAt < :to", { to: filter.to });
    if (filter.cursor) query.andWhere("event.id < :cursor", { cursor: filter.cursor });
    const rows = await query.orderBy("event.id", "DESC").take(filter.limit + 1).getMany();
    const items = rows.slice(0, filter.limit);
    return { items, nextCursor: rows.length > filter.limit ? items.at(-1)!.id : null };
  }
}
