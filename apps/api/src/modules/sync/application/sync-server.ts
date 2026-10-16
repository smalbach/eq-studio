/**
 * The cloud's side of sync: a feed of what changed, and pushes merged field by field.
 */
import { Inject } from "@nestjs/common";
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { EntityManager } from "typeorm";
import type { SyncConflictRow } from "../../../database/entities.ts";
import { Conflict, Forbidden, Invalid, NotFound } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { rank, requireRole, type Actor } from "../../../shared/rbac.ts";
import { IMMUTABLE, labelOf, merge, REQUIRED_ROLE, sameSnapshot, SYNC_ORDER, withField, type Snapshot, type SyncType } from "../domain/merge.ts";
import { SyncStore } from "../infrastructure/sync.store.ts";

export type PushItem = { type: SyncType; id: string; baseRev?: number | null; base?: Snapshot | null; data: Snapshot };
export type PushResult = { type: SyncType; id: string; status: "applied" | "merged" | "conflict" | "aliased" | "unchanged" | "rejected"; rev?: number; data?: Snapshot; canonicalId?: string; conflicts?: { id: string; field: string; mine: unknown; theirs: unknown }[]; error?: string };

export class PullChangesQuery { constructor(readonly actor: Actor, readonly since: number, readonly limit: number) {} }

@QueryHandler(PullChangesQuery)
export class PullChangesHandler implements IQueryHandler<PullChangesQuery> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ actor, since, limit }: PullChangesQuery) {
    const page = await this.store.changedSince(actor.workspaceId, since, limit, SYNC_ORDER);
    const openConflicts = (await this.store.openConflicts(actor.workspaceId)).map((row) => row.id);
    return { ...page, openConflicts };
  }
}

export class PushChangesCommand { constructor(readonly actor: Actor, readonly device: string, readonly items: PushItem[], readonly resolved: string[]) {} }

/**
 * Each item in a transaction of its own: one rejected change does not hold back the rest.
 * References to a contract version the cloud already had under another id are rewritten to
 * that id before anything is written.
 */
@CommandHandler(PushChangesCommand)
export class PushChangesHandler implements ICommandHandler<PushChangesCommand, { results: PushResult[] }> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ actor, device, items, resolved }: PushChangesCommand) {
    const workspaceId = actor.workspaceId;
    if (resolved.length) await this.store.resolveConflicts(workspaceId, resolved, null);
    const sorted = [...items].sort((a, b) => SYNC_ORDER.indexOf(a.type) - SYNC_ORDER.indexOf(b.type));
    const results: PushResult[] = [];
    for (const item of sorted) {
      if (rank(actor.role) < rank(REQUIRED_ROLE[item.type])) { results.push({ type: item.type, id: item.id, status: "rejected", error: `Needs the ${REQUIRED_ROLE[item.type]} role; this device acts as ${actor.role}` }); continue; }
      try {
        results.push(await this.store.transaction((tx) => this.one(workspaceId, device, item, tx)));
      } catch (error) {
        results.push({ type: item.type, id: item.id, status: "rejected", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results };
  }

  private async one(workspaceId: string, device: string, item: PushItem, tx: EntityManager): Promise<PushResult> {
    const data = await this.translate(workspaceId, item, tx);
    if (item.type === "spec") {
      const alias = (await this.store.aliases(workspaceId, "spec", [item.id], tx)).get(item.id);
      const duplicate = alias ? { id: alias } : await this.store.specByHash(workspaceId, String(data.projectId), String(data.hash), tx);
      if (duplicate && duplicate.id !== item.id) {
        if (!alias) await this.store.addAlias(workspaceId, "spec", item.id, duplicate.id, tx);
        return { type: "spec", id: item.id, status: "aliased", canonicalId: duplicate.id, rev: 1 };
      }
    }
    const current = await this.store.load(item.type, workspaceId, item.id, tx);
    if (!current) {
      const stored = await this.store.apply(item.type, workspaceId, item.id, data, "incoming", tx);
      return { type: item.type, id: item.id, status: "applied", rev: stored.rev, data: stored.data };
    }
    if (IMMUTABLE.has(item.type)) return { type: item.type, id: item.id, status: "unchanged", rev: current.rev, data: current.data };
    const base = item.baseRev === current.rev ? current.data : item.base ?? null;
    const merged = merge(item.type, base, current.data, data);
    if (!merged.conflicts.length && !merged.changed) return { type: item.type, id: item.id, status: "unchanged", rev: current.rev, data: current.data };
    let stored = current;
    if (merged.changed && !sameSnapshot(item.type, merged.data, current.data)) stored = await this.store.apply(item.type, workspaceId, item.id, merged.data, "incoming", tx);
    const conflicts: PushResult["conflicts"] = [];
    for (const conflict of merged.conflicts) {
      await this.store.supersede(workspaceId, item.type, item.id, conflict.field, tx);
      const row: SyncConflictRow = { id: uuidv7(), workspaceId, type: item.type, entityId: item.id, label: labelOf(item.type, stored.data).slice(0, 300), field: conflict.field, mine: conflict.mine, theirs: conflict.theirs, device: device.slice(0, 200), createdAt: isoNow(), resolvedAt: null, resolution: null };
      await this.store.saveConflict(row, tx);
      conflicts.push({ id: row.id, field: row.field, mine: row.mine, theirs: row.theirs });
    }
    return { type: item.type, id: item.id, status: conflicts.length ? "conflict" : item.baseRev === current.rev ? "applied" : "merged", rev: stored.rev, data: stored.data, ...(conflicts.length ? { conflicts } : {}) };
  }

  private async translate(workspaceId: string, item: PushItem, tx: EntityManager): Promise<Snapshot> {
    const reference = item.type === "project" ? "activeSpecVersionId" : item.type === "run" ? "specVersionId" : null;
    const value = reference ? item.data[reference] : null;
    if (!reference || typeof value !== "string") return item.data;
    const alias = (await this.store.aliases(workspaceId, "spec", [value], tx)).get(value);
    return alias ? { ...item.data, [reference]: alias } : item.data;
  }
}

export class ListConflictsQuery { constructor(readonly workspaceId: string) {} }

@QueryHandler(ListConflictsQuery)
export class ListConflictsHandler implements IQueryHandler<ListConflictsQuery> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ workspaceId }: ListConflictsQuery) {
    return (await this.store.openConflicts(workspaceId)).map(({ id, type, entityId, label, field, mine, theirs, device, createdAt }) => ({ id, type, entityId, label, field, mine: redact(type, mine), theirs: redact(type, theirs), device, createdAt }));
  }
}

/** An encrypted secret is shown as what it is, not as ciphertext. */
const redact = (type: SyncType, value: unknown) => type === "credential" && value && typeof value === "object" ? "••••" : value;

export class ResolveConflictCommand { constructor(readonly actor: Actor, readonly id: string, readonly choice: "mine" | "theirs") {} }

/** In the cloud: "mine" is the device's value, written now; "theirs" keeps what the cloud has. */
@CommandHandler(ResolveConflictCommand)
export class ResolveConflictHandler implements ICommandHandler<ResolveConflictCommand, void> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ actor, id, choice }: ResolveConflictCommand) {
    const conflict = await this.store.conflict(actor.workspaceId, id);
    if (!conflict) throw new NotFound(`Conflict ${id}`);
    if (conflict.resolvedAt) throw new Conflict("This conflict was already resolved");
    requireRole(actor, REQUIRED_ROLE[conflict.type], "Resolving this conflict");
    await this.store.transaction(async (tx) => {
      if (choice === "mine") {
        const current = await this.store.load(conflict.type, actor.workspaceId, conflict.entityId, tx);
        if (!current) throw new NotFound(`${conflict.type} ${conflict.entityId}`);
        await this.store.apply(conflict.type, actor.workspaceId, conflict.entityId, withField(conflict.type, current.data, conflict.field, conflict.mine), "incoming", tx);
      }
      await this.store.resolveConflicts(actor.workspaceId, [id], choice, tx);
    });
  }
}

const KEYCHECK = "keycheck";

export class GetKeyCheckQuery { constructor(readonly workspaceId: string) {} }

/** The passphrase check of a workspace: a known text, encrypted end to end by the first device. */
@QueryHandler(GetKeyCheckQuery)
export class GetKeyCheckHandler implements IQueryHandler<GetKeyCheckQuery> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ workspaceId }: GetKeyCheckQuery) {
    return { check: (await this.store.object(workspaceId, KEYCHECK, KEYCHECK))?.data ?? null };
  }
}

export class SetKeyCheckCommand { constructor(readonly actor: Actor, readonly check: Snapshot) {} }

@CommandHandler(SetKeyCheckCommand)
export class SetKeyCheckHandler implements ICommandHandler<SetKeyCheckCommand, void> {
  constructor(@Inject(SyncStore) private readonly store: SyncStore) {}

  async execute({ actor, check }: SetKeyCheckCommand) {
    requireRole(actor, "admin", "Turning on end-to-end encrypted secrets");
    if (typeof check.sealed !== "string" || typeof check.salt !== "string") throw new Invalid("The check needs `sealed` and `salt`");
    if (await this.store.object(actor.workspaceId, KEYCHECK, KEYCHECK)) throw new Forbidden("This workspace already has a passphrase; every device uses that one");
    await this.store.saveObject(actor.workspaceId, KEYCHECK, KEYCHECK, check);
  }
}
