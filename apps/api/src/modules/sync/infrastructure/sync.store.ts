import { Inject, Injectable } from "@nestjs/common";
import { In, IsNull, LessThan, MoreThan, Not, type DataSource, type EntityManager } from "typeorm";
import type { ProjectOperation } from "@eq/runner-core";
import {
  CredentialEntity, DeviceCodeEntity, EnvironmentEntity, OperationEntity, ProjectEntity, RunCaseEntity, RunEntity, SpecVersionEntity, SyncAliasEntity, SyncConflictEntity, SyncLinkEntity, SyncObjectEntity, SyncStateEntity,
  type CredentialRole, type CredentialRow, type DeviceCodeRow, type EnvironmentRow, type OperationRow, type ProjectRow, type RunCaseRow, type RunRow, type SpecVersionRow, type SyncConflictRow, type SyncLinkRow, type SyncObjectRow, type SyncStateRow,
} from "../../../database/entities.ts";
import { Forbidden } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { withSyncSeq } from "../../../shared/sync-seq.ts";
import { DATA_SOURCE } from "../../../shared/tokens.ts";
import type { Snapshot, SyncType } from "../domain/merge.ts";

export type StoredEntity = { type: SyncType; id: string; rev: number; seq: number; data: Snapshot };
export type Change = { type: SyncType; id: string; rev: number; data: Snapshot };

/** Steps of a run travel without request and response bodies: they are the bulk, not the verdict. */
const lean = (cases: RunCaseRow[]) => cases.map((item) => ({ ...omit(item, ["runId"]), steps: item.steps?.map((step) => omit(step, ["requestBody", "responseBody"])) ?? null }));

function omit<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Rows of a workspace as snapshots and back, the change cursor, and the bookkeeping of both
 * sides of sync. Every write here goes through `withSyncSeq`, like any other write of a synced
 * row, so the change it makes is itself visible to the next "what changed since".
 */
@Injectable()
export class SyncStore {
  constructor(@Inject(DATA_SOURCE) readonly db: DataSource) {}

  private m(tx?: EntityManager) { return tx ?? this.db.manager; }

  transaction<T>(work: (tx: EntityManager) => Promise<T>) { return this.db.transaction(work); }

  // ── Snapshots ────────────────────────────────────────────────────────────────

  private projectData(row: ProjectRow): Snapshot {
    return { slug: row.slug, name: row.name, config: row.config, load: row.load, activeSpecVersionId: row.activeSpecVersionId, createdAt: row.createdAt, deletedAt: row.deletedAt };
  }

  private environmentData(row: EnvironmentRow): Snapshot {
    return { projectId: row.projectId, key: row.key, name: row.name, baseUrl: row.baseUrl, specUrl: row.specUrl, seeded: row.seeded, writesAllowed: row.writesAllowed, enforceLatency: row.enforceLatency, authEnabled: row.authEnabled, description: row.description, createdAt: row.createdAt, deletedAt: row.deletedAt };
  }

  private async specData(row: SpecVersionRow, tx?: EntityManager): Promise<Snapshot> {
    const operations = await this.m(tx).getRepository(OperationEntity).find({ where: { specVersionId: row.id }, order: { position: "ASC" } });
    return {
      projectId: row.projectId, hash: row.hash, sourceKind: row.sourceKind, sourceUrl: row.sourceUrl, openapiVersion: row.openapiVersion, title: row.title, version: row.version, document: row.document, operationCount: row.operationCount, createdAt: row.createdAt,
      operations: operations.map((item): ProjectOperation => ({ id: item.operationId, method: item.method as ProjectOperation["method"], path: item.path, tag: item.tag, summary: item.summary, statuses: item.statuses, parameters: item.parameters, ...(item.internal ? { internal: true } : {}) })),
    };
  }

  private async runData(row: RunRow, tx?: EntityManager): Promise<Snapshot> {
    const cases = await this.m(tx).getRepository(RunCaseEntity).find({ where: { runId: row.id }, order: { position: "ASC" } });
    return { ...omit(row, ["id", "workspaceId", "syncSeq"]), cases: lean(cases) };
  }

  /** One entity of a workspace, deleted or not; credentials only as the cloud keeps them. */
  async load(type: SyncType, workspaceId: string, id: string, tx?: EntityManager): Promise<StoredEntity | null> {
    const m = this.m(tx);
    if (type === "project") { const row = await m.getRepository(ProjectEntity).findOne({ where: { workspaceId, id } }); return row && { type, id, rev: row.rev, seq: row.syncSeq ?? 0, data: this.projectData(row) }; }
    if (type === "environment") { const row = await m.getRepository(EnvironmentEntity).findOne({ where: { workspaceId, id } }); return row && { type, id, rev: row.rev, seq: row.syncSeq ?? 0, data: this.environmentData(row) }; }
    if (type === "spec") { const row = await m.getRepository(SpecVersionEntity).findOne({ where: { workspaceId, id } }); return row && { type, id, rev: 1, seq: row.syncSeq ?? 0, data: await this.specData(row, tx) }; }
    if (type === "run") { const row = await m.getRepository(RunEntity).findOne({ where: { workspaceId, id } }); return row && { type, id, rev: 1, seq: row.syncSeq ?? 0, data: await this.runData(row, tx) }; }
    const row = await m.getRepository(SyncObjectEntity).findOne({ where: { workspaceId, type, id } });
    return row && { type, id, rev: row.rev, seq: row.syncSeq, data: row.data };
  }

  /**
   * Writes a snapshot. A slug or environment key already used by another row is renamed:
   * the incoming row's (`rename: "incoming"`, the cloud keeps what it has) or the existing
   * one's (`rename: "existing"`, a device takes the cloud's names and its own unsynced row
   * moves aside — and is pushed under its new name).
   */
  async apply(type: SyncType, workspaceId: string, id: string, data: Snapshot, rename: "incoming" | "existing", tx: EntityManager): Promise<StoredEntity> {
    await this.assertOwned(type, workspaceId, id, data, tx);
    const now = isoNow();
    if (type === "project") {
      const repo = tx.getRepository(ProjectEntity);
      const current = await repo.findOne({ where: { workspaceId, id } });
      let slug = String(data.slug);
      const holder = await repo.findOne({ where: { workspaceId, slug, id: Not(id) } });
      if (holder) {
        if (rename === "incoming") slug = await this.freeSlug(tx, workspaceId, slug);
        else await withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => { await manager.getRepository(ProjectEntity).save({ ...holder, slug: await this.freeSlug(manager, workspaceId, slug), rev: holder.rev + 1, updatedAt: now, syncSeq: seq }); });
      }
      const row: ProjectRow = { id, workspaceId, slug, name: String(data.name), config: data.config as ProjectRow["config"], load: (data.load ?? null) as ProjectRow["load"], activeSpecVersionId: (data.activeSpecVersionId ?? null) as string | null, rev: (current?.rev ?? 0) + 1, createdAt: current?.createdAt ?? String(data.createdAt ?? now), updatedAt: now, deletedAt: (data.deletedAt ?? null) as string | null };
      return withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => { await manager.getRepository(ProjectEntity).save({ ...row, syncSeq: seq }); return { type, id, rev: row.rev, seq, data: this.projectData(row) }; });
    }
    if (type === "environment") {
      const repo = tx.getRepository(EnvironmentEntity);
      const current = await repo.findOne({ where: { workspaceId, id } });
      const projectId = String(data.projectId);
      let key = String(data.key);
      const holder = await repo.findOne({ where: { projectId, key, id: Not(id) } });
      if (holder) {
        if (rename === "incoming") key = await this.freeKey(tx, projectId, key);
        else await withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => { await manager.getRepository(EnvironmentEntity).save({ ...holder, key: await this.freeKey(manager, projectId, key), rev: holder.rev + 1, updatedAt: now, syncSeq: seq }); });
      }
      const row: EnvironmentRow = {
        id, workspaceId, projectId, key, name: String(data.name), baseUrl: String(data.baseUrl), specUrl: (data.specUrl ?? null) as string | null, seeded: (data.seeded ?? null) as boolean | null, writesAllowed: (data.writesAllowed ?? null) as boolean | null, enforceLatency: (data.enforceLatency ?? null) as boolean | null, authEnabled: (data.authEnabled ?? null) as boolean | null, description: (data.description ?? null) as EnvironmentRow["description"],
        rev: (current?.rev ?? 0) + 1, createdAt: current?.createdAt ?? String(data.createdAt ?? now), updatedAt: now, deletedAt: (data.deletedAt ?? null) as string | null,
      };
      return withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => { await manager.getRepository(EnvironmentEntity).save({ ...row, syncSeq: seq }); return { type, id, rev: row.rev, seq, data: this.environmentData(row) }; });
    }
    if (type === "spec") {
      const existing = await this.load(type, workspaceId, id, tx);
      if (existing) return existing;
      const operations = (data.operations ?? []) as ProjectOperation[];
      const row: SpecVersionRow = { id, workspaceId, projectId: String(data.projectId), hash: String(data.hash), sourceKind: data.sourceKind as SpecVersionRow["sourceKind"], sourceUrl: (data.sourceUrl ?? null) as string | null, openapiVersion: (data.openapiVersion ?? null) as string | null, title: (data.title ?? null) as string | null, version: (data.version ?? null) as string | null, document: (data.document ?? null) as string | null, operationCount: Number(data.operationCount ?? operations.length), createdAt: String(data.createdAt ?? now) };
      return withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => {
        await manager.getRepository(SpecVersionEntity).insert({ ...row, syncSeq: seq });
        const rows: OperationRow[] = operations.map((operation, position) => ({ id: uuidv7(), specVersionId: id, operationId: operation.id, method: operation.method, path: operation.path, tag: operation.tag, summary: operation.summary, statuses: operation.statuses, parameters: operation.parameters, internal: Boolean(operation.internal), position }));
        for (let index = 0; index < rows.length; index += 50) await manager.getRepository(OperationEntity).insert(rows.slice(index, index + 50));
        return { type, id, rev: 1, seq, data: await this.specData(row, manager) };
      });
    }
    if (type === "run") {
      const existing = await this.load(type, workspaceId, id, tx);
      if (existing) return existing;
      const { cases = [], ...fields } = data as Snapshot & { cases?: (Omit<RunCaseRow, "runId">)[] };
      const run = { ...fields, id, workspaceId } as RunRow;
      return withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => {
        await manager.getRepository(RunEntity).insert({ ...run, syncSeq: seq } as never);
        const rows = cases.map((item) => ({ ...item, runId: id }));
        for (let index = 0; index < rows.length; index += 50) await manager.getRepository(RunCaseEntity).insert(rows.slice(index, index + 50) as never);
        return { type, id, rev: 1, seq, data: await this.runData(run, manager) };
      });
    }
    const repo = tx.getRepository(SyncObjectEntity);
    const current = await repo.findOne({ where: { workspaceId, type, id } });
    return withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => {
      const row: SyncObjectRow = { id, workspaceId, type, data, rev: (current?.rev ?? 0) + 1, syncSeq: seq, updatedAt: now };
      await manager.getRepository(SyncObjectEntity).save(row);
      return { type, id, rev: row.rev, seq, data };
    });
  }

  /**
   * Ids are global and chosen by devices: an entity, or anything it points at, that exists in
   * another workspace is refused — never overwritten, never linked across tenants.
   */
  private async assertOwned(type: SyncType, workspaceId: string, id: string, data: Snapshot, tx: EntityManager) {
    const foreign = async (entity: typeof ProjectEntity | typeof EnvironmentEntity | typeof SpecVersionEntity | typeof RunEntity, value: unknown) => {
      if (typeof value !== "string" || !value) return false;
      const row = await tx.getRepository(entity as typeof ProjectEntity).findOne({ where: { id: value }, select: ["id", "workspaceId"] });
      return Boolean(row && row.workspaceId !== workspaceId);
    };
    const own = { project: ProjectEntity, environment: EnvironmentEntity, spec: SpecVersionEntity, run: RunEntity }[type as "project"];
    const checks: [typeof ProjectEntity | typeof EnvironmentEntity | typeof SpecVersionEntity | typeof RunEntity, unknown][] = own ? [[own, id]] : [];
    if (type === "project") checks.push([SpecVersionEntity, data.activeSpecVersionId]);
    if (type === "environment" || type === "spec" || type === "run") checks.push([ProjectEntity, data.projectId]);
    if (type === "run") checks.push([EnvironmentEntity, data.environmentId], [SpecVersionEntity, data.specVersionId]);
    if (type === "credential") checks.push([EnvironmentEntity, data.environmentId]);
    for (const [entity, value] of checks) if (await foreign(entity, value)) throw new Forbidden("This change refers to something that belongs to another workspace");
  }

  private async freeSlug(tx: EntityManager, workspaceId: string, slug: string) {
    for (let index = 2; ; index += 1) { const candidate = `${slug}-${index}`; if (!await tx.getRepository(ProjectEntity).count({ where: { workspaceId, slug: candidate } })) return candidate; }
  }

  private async freeKey(tx: EntityManager, projectId: string, key: string) {
    for (let index = 2; ; index += 1) { const candidate = `${key}-${index}`; if (!await tx.getRepository(EnvironmentEntity).count({ where: { projectId, key: candidate } })) return candidate; }
  }

  // ── The cloud's change feed ─────────────────────────────────────────────────

  /** Everything written after `cursor`, oldest first. A run shows up once it finished. */
  async changedSince(workspaceId: string, cursor: number, limit: number, types: SyncType[]): Promise<{ changes: Change[]; cursor: number; more: boolean }> {
    const after = { workspaceId, syncSeq: MoreThan(cursor) };
    const page = { order: { syncSeq: "ASC" as const }, take: limit + 1 };
    const found: { seq: number; load: () => Promise<Change> }[] = [];
    if (types.includes("spec")) for (const row of await this.db.manager.getRepository(SpecVersionEntity).find({ where: after, ...page })) found.push({ seq: row.syncSeq ?? 0, load: async () => ({ type: "spec", id: row.id, rev: 1, data: await this.specData(row) }) });
    if (types.includes("project")) for (const row of await this.db.manager.getRepository(ProjectEntity).find({ where: after, ...page })) found.push({ seq: row.syncSeq ?? 0, load: async () => ({ type: "project", id: row.id, rev: row.rev, data: this.projectData(row) }) });
    if (types.includes("environment")) for (const row of await this.db.manager.getRepository(EnvironmentEntity).find({ where: after, ...page })) found.push({ seq: row.syncSeq ?? 0, load: async () => ({ type: "environment", id: row.id, rev: row.rev, data: this.environmentData(row) }) });
    if (types.includes("run")) for (const row of await this.db.manager.getRepository(RunEntity).find({ where: { ...after, finishedAt: Not(IsNull()) }, ...page })) found.push({ seq: row.syncSeq ?? 0, load: async () => ({ type: "run", id: row.id, rev: 1, data: await this.runData(row) }) });
    if (types.includes("credential")) for (const row of await this.db.manager.getRepository(SyncObjectEntity).find({ where: { ...after, type: "credential" }, ...page })) found.push({ seq: row.syncSeq, load: async () => ({ type: "credential", id: row.id, rev: row.rev, data: row.data }) });
    found.sort((a, b) => a.seq - b.seq);
    const taken = found.slice(0, limit);
    const changes: Change[] = [];
    for (const item of taken) changes.push(await item.load());
    return { changes, cursor: taken.length ? taken[taken.length - 1].seq : cursor, more: found.length > limit };
  }

  // ── A device's view: what changed here since the last agreement ─────────────

  /** Ids and change numbers of a workspace's synced rows (runs: only finished ones). */
  async localRows(workspaceId: string): Promise<{ type: SyncType; id: string; seq: number; projectId: string | null }[]> {
    const m = this.db.manager;
    const rows: { type: SyncType; id: string; seq: number; projectId: string | null }[] = [];
    for (const row of await m.getRepository(SpecVersionEntity).find({ where: { workspaceId }, select: ["id", "syncSeq", "projectId"] })) rows.push({ type: "spec", id: row.id, seq: row.syncSeq ?? 0, projectId: row.projectId });
    for (const row of await m.getRepository(ProjectEntity).find({ where: { workspaceId }, select: ["id", "syncSeq"] })) rows.push({ type: "project", id: row.id, seq: row.syncSeq ?? 0, projectId: row.id });
    for (const row of await m.getRepository(EnvironmentEntity).find({ where: { workspaceId }, select: ["id", "syncSeq", "projectId"] })) rows.push({ type: "environment", id: row.id, seq: row.syncSeq ?? 0, projectId: row.projectId });
    for (const row of await m.getRepository(RunEntity).find({ where: { workspaceId, finishedAt: Not(IsNull()) }, select: ["id", "syncSeq", "projectId"] })) rows.push({ type: "run", id: row.id, seq: row.syncSeq ?? 0, projectId: row.projectId });
    return rows;
  }

  /** A device's credentials, to encrypt end to end; never read in the cloud. */
  credentials(workspaceId: string) { return this.db.manager.getRepository(CredentialEntity).find({ where: { workspaceId } }); }

  credential(environmentId: string, role: CredentialRole, tx?: EntityManager) { return this.m(tx).getRepository(CredentialEntity).findOne({ where: { environmentId, role } }); }

  async saveCredential(row: CredentialRow, tx?: EntityManager): Promise<number> {
    return withSyncSeq(this.db, tx, row.workspaceId, async (manager, seq) => { await manager.getRepository(CredentialEntity).save({ ...row, syncSeq: seq }); return seq; });
  }

  environment(workspaceId: string, id: string) { return this.db.manager.getRepository(EnvironmentEntity).findOne({ where: { workspaceId, id } }); }

  /** Points every reference at one contract version instead of its duplicate, and drops the duplicate. */
  async mergeSpec(workspaceId: string, fromId: string, toId: string, tx: EntityManager) {
    for (const project of await tx.getRepository(ProjectEntity).find({ where: { workspaceId, activeSpecVersionId: fromId } })) {
      await withSyncSeq(this.db, tx, workspaceId, async (manager, seq) => { await manager.getRepository(ProjectEntity).save({ ...project, activeSpecVersionId: toId, rev: project.rev + 1, updatedAt: isoNow(), syncSeq: seq }); });
    }
    await tx.getRepository(RunEntity).update({ workspaceId, specVersionId: fromId }, { specVersionId: toId });
    await tx.getRepository(OperationEntity).delete({ specVersionId: fromId });
    await tx.getRepository(SpecVersionEntity).delete({ workspaceId, id: fromId });
    await tx.getRepository(SyncStateEntity).delete({ type: "spec", entityId: fromId });
  }

  specByHash(workspaceId: string, projectId: string, hash: string, tx?: EntityManager) {
    return this.m(tx).getRepository(SpecVersionEntity).findOne({ where: { workspaceId, projectId, hash }, select: ["id"] });
  }

  // ── Aliases (cloud): a duplicate contract version a device pushed, and the one kept ──

  async aliases(workspaceId: string, type: string, ids: string[], tx?: EntityManager) {
    if (!ids.length) return new Map<string, string>();
    const rows = await this.m(tx).getRepository(SyncAliasEntity).find({ where: { workspaceId, type, fromId: In(ids) } });
    return new Map(rows.map((row) => [row.fromId, row.toId]));
  }

  async addAlias(workspaceId: string, type: string, fromId: string, toId: string, tx: EntityManager) {
    await tx.getRepository(SyncAliasEntity).save({ workspaceId, type, fromId, toId, createdAt: isoNow() });
  }

  // ── Objects the cloud keeps without reading them ─────────────────────────────

  object(workspaceId: string, type: string, id: string) {
    return this.db.manager.getRepository(SyncObjectEntity).findOne({ where: { workspaceId, type, id } });
  }

  async saveObject(workspaceId: string, type: string, id: string, data: Snapshot) {
    await this.db.manager.getRepository(SyncObjectEntity).save({ id, workspaceId, type, data, rev: 1, syncSeq: 0, updatedAt: isoNow() });
  }

  // ── Conflicts ────────────────────────────────────────────────────────────────

  openConflicts(workspaceId: string) {
    return this.db.manager.getRepository(SyncConflictEntity).find({ where: { workspaceId, resolvedAt: IsNull() }, order: { createdAt: "ASC", id: "ASC" } });
  }

  conflict(workspaceId: string, id: string) {
    return this.db.manager.getRepository(SyncConflictEntity).findOne({ where: { workspaceId, id } });
  }

  async saveConflict(row: SyncConflictRow, tx?: EntityManager) { await this.m(tx).getRepository(SyncConflictEntity).save(row); }

  async resolveConflicts(workspaceId: string, ids: string[], resolution: "mine" | "theirs" | null, tx?: EntityManager) {
    if (ids.length) await this.m(tx).getRepository(SyncConflictEntity).update({ workspaceId, id: In(ids), resolvedAt: IsNull() }, { resolvedAt: isoNow(), resolution });
  }

  /** Open conflicts of an entity's field, superseded by a newer one about the same field. */
  async supersede(workspaceId: string, type: SyncType, entityId: string, field: string, tx: EntityManager) {
    await tx.getRepository(SyncConflictEntity).update({ workspaceId, type, entityId, field, resolvedAt: IsNull() }, { resolvedAt: isoNow(), resolution: null });
  }

  /** A device drops the conflicts the cloud no longer has open (someone resolved them there). */
  async dropConflictsExcept(workspaceId: string, keep: string[]) {
    const open = await this.openConflicts(workspaceId);
    const gone = open.filter((row) => !keep.includes(row.id)).map((row) => row.id);
    await this.resolveConflicts(workspaceId, gone, null);
  }

  // ── A device's bookkeeping ───────────────────────────────────────────────────

  async states(): Promise<Map<string, SyncStateRow>> {
    const rows = await this.db.manager.getRepository(SyncStateEntity).find();
    return new Map(rows.map((row) => [`${row.type}:${row.entityId}`, row]));
  }

  state(type: SyncType, entityId: string, tx?: EntityManager) { return this.m(tx).getRepository(SyncStateEntity).findOne({ where: { type, entityId } }); }

  async saveState(row: SyncStateRow, tx?: EntityManager) { await this.m(tx).getRepository(SyncStateEntity).save(row); }

  async clearStates() { await this.db.manager.getRepository(SyncStateEntity).clear(); }

  async link(): Promise<SyncLinkRow | null> { return (await this.db.manager.getRepository(SyncLinkEntity).find({ take: 1 }))[0] ?? null; }

  async saveLink(row: SyncLinkRow) { await this.db.manager.getRepository(SyncLinkEntity).save(row); }

  async deleteLink() {
    await this.db.manager.getRepository(SyncLinkEntity).clear();
    await this.db.manager.getRepository(SyncStateEntity).clear();
    await this.db.manager.getRepository(SyncConflictEntity).clear();
  }

  // ── Signing a device in from the browser (cloud) ────────────────────────────

  async saveDeviceCode(row: DeviceCodeRow) { await this.db.manager.getRepository(DeviceCodeEntity).save(row); }

  /** Approved → used, once: two polls at the same moment do not both get a token. */
  async claimDeviceCode(id: string) {
    return ((await this.db.manager.getRepository(DeviceCodeEntity).update({ id, status: "approved" }, { status: "used" })).affected ?? 0) > 0;
  }

  deviceCodeByHash(hash: string) { return this.db.manager.getRepository(DeviceCodeEntity).findOne({ where: { deviceCodeHash: hash } }); }

  deviceCodeByUserCode(userCode: string) { return this.db.manager.getRepository(DeviceCodeEntity).findOne({ where: { userCode } }); }

  async purgeDeviceCodes() { await this.db.manager.getRepository(DeviceCodeEntity).delete({ expiresAt: LessThan(new Date(Date.now() - 86_400_000).toISOString()) }); }
}
