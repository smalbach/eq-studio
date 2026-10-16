/**
 * A local installation's side of sync: the link to a cloud workspace, and `sync` itself —
 * pull what the cloud has that this device does not, then push what changed here.
 *
 * What this device last agreed with the cloud about each entity is kept in `sync_state`: the
 * cloud's revision and the snapshot both sides had (the "shadow"). A row written here after
 * that agreement has a higher change number, so it is pushed, with the shadow as the base of
 * the cloud's three-way merge. A row this device changed is never overwritten by a pull: the
 * push that follows merges it.
 *
 * Credentials stay on this device unless a passphrase is set. With one, they travel encrypted
 * end to end: a key derived from the passphrase (scrypt) seals them with AES-256-GCM before
 * they leave, and the cloud keeps only ciphertext it cannot read.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { AppConfig } from "../../../config.ts";
import type { CredentialRow, SyncConflictRow, SyncLinkRow } from "../../../database/entities.ts";
import { Conflict, Invalid, NotFound, Unreachable } from "../../../shared/errors.ts";
import { isoNow, uuidv7 } from "../../../shared/ids.ts";
import { lastFour, type SecretBox } from "../../../shared/secret-box.ts";
import { openExtras, sealExtras, type ExtraSecrets } from "../../credentials/domain/credential.ts";
import { APP_CONFIG, SECRET_BOX } from "../../../shared/tokens.ts";
import { LOCAL_WORKSPACE_ID } from "../../../shared/workspace.ts";
import { IMMUTABLE, projectOf, sameSnapshot, stable, SYNC_ORDER, withField, type Snapshot, type SyncType } from "../domain/merge.ts";
import { SyncStore, type Change } from "../infrastructure/sync.store.ts";
import type { PushItem, PushResult } from "./sync-server.ts";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const WORKSPACE = LOCAL_WORKSPACE_ID;
const PULL_PAGE = 100;
const PUSH_BYTES = 4_000_000;
const PUSH_ITEMS = 50;
const KEYCHECK_TEXT = "endpoint-quality keycheck v1";

export type SyncResult = { pulled: number; pushed: number; conflicts: number; rejected: { type: string; id: string; error: string }[]; skipped: number; durationMs: number };

/** Sync could not complete: the cloud, or what it sent, is the problem (a 502 to the caller). */
export class SyncError extends Unreachable {}

/** The cloud answered something other than success. */
class RemoteError extends Unreachable { constructor(readonly code: number, message: string) { super(message); } }

@Injectable()
export class SyncClient implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private deviceTimer: NodeJS.Timeout | null = null;
  private running: Promise<SyncResult> | null = null;
  private polling: Promise<void> | null = null;

  constructor(@Inject(SyncStore) private readonly store: SyncStore, @Inject(SECRET_BOX) private readonly box: SecretBox, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  // ── Lifecycle: automatic sync and a sign-in in progress survive restarts ─────

  async onApplicationBootstrap() {
    const seconds = this.config.sync?.intervalSeconds ?? 0;
    if (seconds > 0) {
      this.timer = setInterval(() => { void this.syncIfLinked(); }, seconds * 1000);
      this.timer.unref();
    }
    const link = await this.store.link();
    if (link?.pending) this.scheduleDevicePoll(link.pending.interval);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
  }

  private async syncIfLinked() {
    const link = await this.store.link();
    if (link?.token && !this.running) await this.sync().catch(() => { /* recorded on the link */ });
  }

  // ── Status ───────────────────────────────────────────────────────────────────

  async status() {
    const link = await this.store.link();
    const intervalSeconds = this.config.sync?.intervalSeconds ?? 0;
    if (!link) return { linked: false, url: null, workspace: null, deviceName: hostname(), pending: null, includeRuns: true, projects: null, secrets: false, lastSyncAt: null, lastError: null, lastResult: null, openConflicts: 0, pendingChanges: 0, syncing: false, autoSyncSeconds: intervalSeconds };
    const openConflicts = (await this.store.openConflicts(WORKSPACE)).length;
    const pendingChanges = link.token ? (await this.dirty(link)).length : 0;
    return {
      linked: Boolean(link.token), url: link.url, workspace: link.remoteWorkspaceId ? { id: link.remoteWorkspaceId, name: link.remoteWorkspaceName ?? "" } : null, deviceName: link.deviceName,
      pending: link.pending ? { userCode: link.pending.userCode, verificationUri: link.pending.verificationUri, expiresAt: link.pending.expiresAt } : null,
      includeRuns: link.includeRuns, projects: link.projects, secrets: Boolean(link.secretsKey), lastSyncAt: link.lastSyncAt, lastError: link.lastError, lastResult: link.lastResult,
      openConflicts, pendingChanges, syncing: Boolean(this.running), autoSyncSeconds: intervalSeconds,
    };
  }

  // ── Linking ──────────────────────────────────────────────────────────────────

  /** With a token (an API token, for CI or a script) the link is immediate; without, the browser approves it. */
  async link(input: { url: string; token?: string; deviceName?: string }) {
    const existing = await this.store.link();
    if (existing?.token) throw new Conflict(`This installation already syncs with ${existing.url}; unlink it first`);
    const url = normalizeUrl(input.url);
    const deviceName = (input.deviceName ?? hostname()).slice(0, 200);
    const id = existing?.id ?? uuidv7();
    const base: SyncLinkRow = { id, url, remoteWorkspaceId: null, remoteWorkspaceName: null, deviceId: existing?.deviceId ?? uuidv7(), deviceName, token: null, cursor: 0, includeRuns: true, projects: null, secretsKey: null, pending: null, resolved: null, lastSyncAt: null, lastError: null, lastResult: null, createdAt: isoNow() };
    if (input.token) {
      const workspace = await this.remote<{ id: string; name: string }>(url, input.token, "GET", "/v1/workspace");
      await this.store.saveLink({ ...base, token: this.box.encrypt(input.token, id), remoteWorkspaceId: workspace.id, remoteWorkspaceName: workspace.name });
      return this.status();
    }
    const started = await this.remote<{ deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }>(url, null, "POST", "/v1/auth/device", { name: deviceName });
    await this.store.saveLink({ ...base, pending: { deviceCode: this.box.encrypt(started.deviceCode, id), userCode: started.userCode, verificationUri: started.verificationUri, expiresAt: new Date(Date.now() + started.expiresIn * 1000).toISOString(), interval: started.interval } });
    this.scheduleDevicePoll(started.interval);
    return this.status();
  }

  private scheduleDevicePoll(seconds: number) {
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
    this.deviceTimer = setTimeout(() => { void this.checkDevice().then(async () => { const link = await this.store.link(); if (link?.pending) this.scheduleDevicePoll(link.pending.interval); }); }, Math.max(1, seconds) * 1000);
    this.deviceTimer.unref();
  }

  /** Asks the cloud whether the sign-in was approved; one question at a time. */
  checkDevice(): Promise<void> {
    this.polling ??= this.collectDevice().finally(() => { this.polling = null; });
    return this.polling;
  }

  private async collectDevice() {
    const link = await this.store.link();
    if (!link?.pending || link.token) return;
    try {
      const deviceCode = this.box.decrypt(link.pending.deviceCode, link.id);
      const answer = await this.remoteRaw(link.url, null, "POST", "/v1/auth/device/token", { deviceCode });
      if (answer.status === 202) return;
      const body = answer.body as { status: string; token?: string; workspace?: { id: string; name: string } };
      if (answer.status === 200 && body.token && body.workspace) {
        await this.store.saveLink({ ...link, token: this.box.encrypt(body.token, link.id), remoteWorkspaceId: body.workspace.id, remoteWorkspaceName: body.workspace.name, pending: null, lastError: null });
        if ((this.config.sync?.intervalSeconds ?? 0) > 0) void this.syncIfLinked();
        return;
      }
      await this.store.saveLink({ ...link, pending: null, lastError: body.status === "denied" ? "The sign-in was denied in the browser" : "The sign-in code expired; link this device again" });
    } catch (error) {
      if (link.pending.expiresAt <= isoNow()) await this.store.saveLink({ ...link, pending: null, lastError: "The sign-in code expired; link this device again" });
      else await this.store.saveLink({ ...link, lastError: message(error) });
    }
  }

  async unlink() {
    const link = await this.store.link();
    if (!link) return;
    // Best effort: the device's token stops working in the cloud too.
    if (link.token) await this.remote(link.url, this.box.decrypt(link.token, link.id), "DELETE", "/v1/auth/device/self").catch(() => undefined);
    if (this.deviceTimer) clearTimeout(this.deviceTimer);
    await this.store.deleteLink();
  }

  /** What to sync. Changing the projects or the runs starts the next pull over from the beginning. */
  async configure(input: { includeRuns?: boolean; projects?: string[] | null; passphrase?: string | null }) {
    const link = await this.requireLink();
    const next = { ...link };
    if (input.includeRuns !== undefined && input.includeRuns !== link.includeRuns) { next.includeRuns = input.includeRuns; next.cursor = 0; }
    if (input.projects !== undefined && stable(input.projects) !== stable(link.projects)) { next.projects = input.projects?.length ? input.projects : null; next.cursor = 0; }
    if (input.passphrase === null) next.secretsKey = null;
    else if (input.passphrase !== undefined) {
      if (input.passphrase.length < 12) throw new Invalid("The passphrase needs at least 12 characters");
      next.secretsKey = this.box.encrypt((await this.passphraseKey(link, input.passphrase)).toString("base64"), link.id);
      // Credentials that came before the key could not be read: read them again.
      next.cursor = 0;
    }
    await this.store.saveLink(next);
    return this.status();
  }

  /** The workspace's key: the passphrase checked against the first device's, or that first check. */
  private async passphraseKey(link: SyncLinkRow, passphrase: string) {
    const token = this.token(link);
    const { check } = await this.remote<{ check: { salt: string; sealed: string } | null }>(link.url, token, "GET", "/v1/sync/keycheck");
    const salt = check ? Buffer.from(check.salt, "base64") : randomBytes(16);
    const key = await scrypt(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const context = `keycheck:${link.remoteWorkspaceId}`;
    if (check) {
      try { if (open(key, check.sealed, context) !== KEYCHECK_TEXT) throw new Error(); } catch { throw new Invalid("The passphrase is not this workspace's: every device uses the one set first"); }
    } else {
      await this.remote(link.url, token, "PUT", "/v1/sync/keycheck", { salt: salt.toString("base64"), sealed: seal(key, KEYCHECK_TEXT, context) });
    }
    return key;
  }

  // ── Sync ─────────────────────────────────────────────────────────────────────

  sync(): Promise<SyncResult> {
    this.running ??= this.syncOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async syncOnce(): Promise<SyncResult> {
    const started = Date.now();
    let link = await this.requireLink();
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, rejected: [], skipped: 0, durationMs: 0 };
    try {
      const token = this.token(link);
      const key = link.secretsKey ? Buffer.from(this.box.decrypt(link.secretsKey, link.id), "base64") : null;

      // 1. Pull.
      let openConflicts: string[] = [];
      for (;;) {
        const page = await this.remote<{ changes: Change[]; cursor: number; more: boolean; openConflicts: string[] }>(link.url, token, "GET", `/v1/sync/changes?since=${link.cursor}&limit=${PULL_PAGE}`);
        for (const change of [...page.changes].sort((a, b) => SYNC_ORDER.indexOf(a.type) - SYNC_ORDER.indexOf(b.type))) {
          if (await this.applyRemote(link, key, change)) result.pulled += 1; else result.skipped += 1;
        }
        link = { ...link, cursor: page.cursor };
        await this.store.saveLink(link);
        openConflicts = page.openConflicts;
        if (!page.more) break;
      }
      await this.store.dropConflictsExcept(WORKSPACE, openConflicts);

      // 2. Push.
      const items = await this.outgoing(link, key);
      const resolved = link.resolved ?? [];
      for (const batch of batches(items)) {
        const { results } = await this.remote<{ results: PushResult[] }>(link.url, token, "POST", "/v1/sync/changes", { deviceId: link.deviceId, device: link.deviceName, items: batch.map(({ item }) => item), resolved: result.pushed === 0 ? resolved : [] });
        const sent = new Map(batch.map((entry) => [`${entry.item.type}:${entry.item.id}`, entry]));
        for (const answer of results) {
          const entry = sent.get(`${answer.type}:${answer.id}`);
          if (!entry) continue;
          if (answer.status === "rejected") { result.rejected.push({ type: answer.type, id: answer.id, error: answer.error ?? "rejected" }); continue; }
          result.pushed += 1;
          result.conflicts += answer.conflicts?.length ?? 0;
          await this.settle(link, key, entry, answer);
        }
      }
      if (resolved.length && !items.length) await this.remote(link.url, token, "POST", "/v1/sync/changes", { deviceId: link.deviceId, device: link.deviceName, items: [], resolved });
      result.durationMs = Date.now() - started;
      await this.store.saveLink({ ...(await this.requireLink()), cursor: link.cursor, resolved: null, lastSyncAt: isoNow(), lastError: null, lastResult: result as unknown as Record<string, unknown> });
      return result;
    } catch (error) {
      const current = await this.store.link();
      if (current) await this.store.saveLink({ ...current, lastError: message(error) });
      throw error;
    }
  }

  private wanted(link: SyncLinkRow, type: SyncType, projectId: string | null) {
    if (type === "run" && !link.includeRuns) return false;
    return !link.projects || (projectId !== null && link.projects.includes(projectId));
  }

  /** Writes a change from the cloud here, unless this device changed the same entity since. */
  private async applyRemote(link: SyncLinkRow, key: Buffer | null, change: Change): Promise<boolean> {
    const { type, id, rev, data } = change;
    if (type === "credential") return this.applyCredential(link, key, change);
    if (!this.wanted(link, type, projectOf(type, id, data))) return false;
    const state = await this.store.state(type, id);
    if (state && rev <= state.remoteRev) return false;
    const local = await this.store.load(type, WORKSPACE, id);
    if (local && (!state || local.seq > state.localSeq)) {
      // Changed here as well: the push merges it. Without a state (an answer lost on the
      // way back), the cloud's version becomes the base, and this device's differences count
      // as its changes.
      if (!state) await this.store.saveState({ type, entityId: id, localSeq: IMMUTABLE.has(type) ? local.seq : -1, remoteRev: rev, shadow: data });
      return false;
    }
    await this.store.transaction(async (tx) => {
      if (type === "spec") {
        const duplicate = await this.store.specByHash(WORKSPACE, String(data.projectId), String(data.hash), tx);
        if (duplicate && duplicate.id !== id) await this.store.mergeSpec(WORKSPACE, duplicate.id, id, tx);
      }
      const stored = await this.store.apply(type, WORKSPACE, id, data, "existing", tx);
      await this.store.saveState({ type, entityId: id, localSeq: stored.seq, remoteRev: rev, shadow: data }, tx);
    });
    return true;
  }

  private async applyCredential(link: SyncLinkRow, key: Buffer | null, change: Change): Promise<boolean> {
    if (!key) return false;
    const environmentId = String(change.data.environmentId);
    const environment = await this.store.environment(WORKSPACE, environmentId);
    if (!environment || !this.wanted(link, "credential", environment.projectId)) return false;
    const state = await this.store.state("credential", change.id);
    if (state && change.rev <= state.remoteRev) return false;
    const existing = await this.store.credential(environmentId, String(change.data.role) as CredentialRow["role"]);
    if (existing && (!state || (existing.syncSeq ?? 0) > state.localSeq)) {
      if (!state) await this.store.saveState({ type: "credential", entityId: change.id, localSeq: -1, remoteRev: change.rev, shadow: change.data });
      return false;
    }
    const seq = await this.writeCredential(link, key, change.id, change.data, existing);
    await this.store.saveState({ type: "credential", entityId: change.id, localSeq: seq, remoteRev: change.rev, shadow: change.data });
    return true;
  }

  /** Opens a sealed credential and stores it here, encrypted with this installation's key. */
  private async writeCredential(link: SyncLinkRow, key: Buffer, syncId: string, data: Snapshot, existing: CredentialRow | null) {
    const environmentId = String(data.environmentId);
    const role = String(data.role) as CredentialRow["role"];
    let plain: Pick<CredentialRow, "kind" | "headerName" | "username" | "tokenUrl" | "clientId" | "scope" | "options"> & { secret: string | null; extras?: ExtraSecrets };
    try { plain = JSON.parse(open(key, String(data.sealed), credentialContext(link, syncId))); } catch { throw new SyncError("A credential from the cloud does not decrypt with this passphrase"); }
    const now = isoNow();
    const row: CredentialRow = existing ?? { id: uuidv7(), workspaceId: WORKSPACE, environmentId, role, kind: plain.kind, headerName: null, username: null, tokenUrl: null, clientId: null, scope: null, secret: null, lastFour: null, options: null, extraSecrets: null, secretHints: null, rev: 0, createdAt: now, updatedAt: now };
    const next: CredentialRow = { ...row, kind: plain.kind, headerName: plain.headerName ?? null, username: plain.username ?? null, tokenUrl: plain.tokenUrl ?? null, clientId: plain.clientId ?? null, scope: plain.scope ?? null, options: plain.options ?? null, secret: plain.secret ? this.box.encrypt(plain.secret, row.id) : null, lastFour: plain.secret ? lastFour(plain.secret) : null, rev: row.rev + 1, updatedAt: now };
    sealExtras(next, plain.extras ?? {}, this.box);
    return this.store.saveCredential(next);
  }

  /** Everything written here since it was last agreed with the cloud. */
  private async dirty(link: SyncLinkRow) {
    const states = await this.store.states();
    const rows = (await this.store.localRows(WORKSPACE)).filter((row) => this.wanted(link, row.type, row.projectId));
    const changed = rows.filter((row) => { const state = states.get(`${row.type}:${row.id}`); return !state || (!IMMUTABLE.has(row.type) && row.seq > state.localSeq); });
    const credentials: { row: CredentialRow; syncId: string }[] = [];
    if (link.secretsKey) {
      const projects = new Map(rows.filter((row) => row.type === "environment").map((row) => [row.id, row.projectId]));
      for (const row of await this.store.credentials(WORKSPACE)) {
        if (!projects.has(row.environmentId)) continue;
        const syncId = `${row.environmentId}:${row.role}`;
        const state = states.get(`credential:${syncId}`);
        if (!state || (row.syncSeq ?? 0) > state.localSeq) credentials.push({ row, syncId });
      }
    }
    return [...changed, ...credentials];
  }

  private async outgoing(link: SyncLinkRow, key: Buffer | null) {
    const states = await this.store.states();
    const items: { item: PushItem; seq: number; size: number }[] = [];
    for (const entry of await this.dirty(link)) {
      if ("row" in entry) {
        if (!key) continue;
        const { row, syncId } = entry;
        const state = states.get(`credential:${syncId}`);
        // Settings and extra secrets only when there are some: a credential of the first kinds
        // seals (and tags) exactly as it did before they existed, so it is not pushed again.
        const extras = openExtras(row, this.box);
        const plain = stable({ kind: row.kind, headerName: row.headerName, username: row.username, tokenUrl: row.tokenUrl, clientId: row.clientId, scope: row.scope, secret: row.secret ? this.box.decrypt(row.secret, row.id) : null, ...(row.options ? { options: row.options } : {}), ...(Object.keys(extras).length ? { extras } : {}) });
        const data = { environmentId: row.environmentId, role: row.role, tag: createHmac("sha256", key).update(`tag:${plain}`).digest("base64url"), sealed: seal(key, plain, credentialContext(link, syncId)) };
        const item: PushItem = { type: "credential", id: syncId, baseRev: state?.remoteRev ?? null, base: state?.shadow ?? null, data };
        items.push({ item, seq: row.syncSeq ?? 0, size: JSON.stringify(item).length });
        continue;
      }
      const stored = await this.store.load(entry.type, WORKSPACE, entry.id);
      if (!stored) continue;
      const state = states.get(`${entry.type}:${entry.id}`);
      const item: PushItem = { type: entry.type, id: entry.id, baseRev: state?.remoteRev ?? null, base: state?.shadow ?? null, data: stored.data };
      items.push({ item, seq: stored.seq, size: JSON.stringify(item).length });
    }
    return items.sort((a, b) => SYNC_ORDER.indexOf(a.item.type) - SYNC_ORDER.indexOf(b.item.type));
  }

  /** The cloud's answer to one pushed entity: what both sides now agree on. */
  private async settle(link: SyncLinkRow, key: Buffer | null, entry: { item: PushItem; seq: number }, answer: PushResult) {
    const { item, seq } = entry;
    if (answer.status === "aliased" && answer.canonicalId) {
      // The cloud already had this contract under another id: this device takes that id.
      const canonicalId = answer.canonicalId;
      await this.store.transaction(async (tx) => {
        const local = await this.store.load("spec", WORKSPACE, item.id, tx);
        // The duplicate leaves first: a project cannot hold two versions with the same hash.
        await this.store.mergeSpec(WORKSPACE, item.id, canonicalId, tx);
        const canonical = (await this.store.load("spec", WORKSPACE, canonicalId, tx)) ?? (local && await this.store.apply("spec", WORKSPACE, canonicalId, local.data, "existing", tx));
        if (canonical) await this.store.saveState({ type: "spec", entityId: canonicalId, localSeq: canonical.seq, remoteRev: 1, shadow: canonical.data }, tx);
      });
      return;
    }
    const data = answer.data ?? item.data;
    const rev = answer.rev ?? 1;
    if (answer.conflicts?.length) {
      for (const conflict of answer.conflicts) {
        const row: SyncConflictRow = { id: conflict.id, workspaceId: WORKSPACE, type: item.type, entityId: item.id, label: labelFor(item), field: conflict.field, mine: conflict.mine, theirs: conflict.theirs, device: link.deviceName, createdAt: isoNow(), resolvedAt: null, resolution: null };
        await this.store.saveConflict(row);
      }
    }
    if (item.type === "credential") {
      const existing = await this.store.credential(String(item.data.environmentId), String(item.data.role) as CredentialRow["role"]);
      const changedHere = (existing?.syncSeq ?? 0) !== seq;
      const localSeq = !changedHere && key && !sameSnapshot("credential", data, item.data) ? await this.writeCredential(link, key, item.id, data, existing) : seq;
      await this.store.saveState({ type: "credential", entityId: item.id, localSeq, remoteRev: rev, shadow: data });
      return;
    }
    const current = await this.store.load(item.type, WORKSPACE, item.id);
    if (!current) return;
    // Written again here while the push was on its way: stays pending, on the new base.
    if (current.seq !== seq) { await this.store.saveState({ type: item.type, entityId: item.id, localSeq: seq, remoteRev: rev, shadow: data }); return; }
    if (IMMUTABLE.has(item.type) || sameSnapshot(item.type, data, current.data)) { await this.store.saveState({ type: item.type, entityId: item.id, localSeq: seq, remoteRev: rev, shadow: data }); return; }
    await this.store.transaction(async (tx) => {
      const stored = await this.store.apply(item.type, WORKSPACE, item.id, data, "existing", tx);
      await this.store.saveState({ type: item.type, entityId: item.id, localSeq: stored.seq, remoteRev: rev, shadow: data }, tx);
    });
  }

  // ── Conflicts ────────────────────────────────────────────────────────────────

  async conflicts() {
    return (await this.store.openConflicts(WORKSPACE)).map(({ id, type, entityId, label, field, mine, theirs, device, createdAt }) => ({ id, type, entityId, label, field, mine: type === "credential" ? "••••" : mine, theirs: type === "credential" ? "••••" : theirs, device, createdAt }));
  }

  /** "mine" writes this device's value again, so the next push carries it; "theirs" keeps the cloud's. */
  async resolve(id: string, choice: "mine" | "theirs") {
    const conflict = await this.store.conflict(WORKSPACE, id);
    if (!conflict || conflict.resolvedAt) throw new NotFound(`Conflict ${id}`);
    if (choice === "mine" && conflict.type !== "credential") {
      await this.store.transaction(async (tx) => {
        const current = await this.store.load(conflict.type, WORKSPACE, conflict.entityId, tx);
        if (!current) throw new NotFound(`${conflict.type} ${conflict.entityId}`);
        await this.store.apply(conflict.type, WORKSPACE, conflict.entityId, withField(conflict.type, current.data, conflict.field, conflict.mine), "existing", tx);
      });
    }
    if (choice === "mine" && conflict.type === "credential") {
      // The secret this device has is the one to keep: mark it changed so it is pushed again.
      const state = await this.store.state("credential", conflict.entityId);
      if (state) await this.store.saveState({ ...state, localSeq: -1 });
    }
    await this.store.resolveConflicts(WORKSPACE, [id], choice);
    const link = await this.store.link();
    if (link) await this.store.saveLink({ ...link, resolved: [...new Set([...(link.resolved ?? []), id])] });
  }

  // ── Talking to the cloud ─────────────────────────────────────────────────────

  private async requireLink() {
    const link = await this.store.link();
    if (!link?.token) throw new Invalid("This installation is not linked to a cloud workspace");
    return link;
  }

  private token(link: SyncLinkRow) { return this.box.decrypt(link.token!, link.id); }

  private async remoteRaw(url: string, token: string | null, method: string, path: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, { method, headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new RemoteError(0, `Could not reach ${url}: ${message(error)}`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  private async remote<T>(url: string, token: string | null, method: string, path: string, body?: unknown): Promise<T> {
    const answer = await this.remoteRaw(url, token, method, path, body);
    if (answer.status >= 200 && answer.status < 300) return answer.body as T;
    const detail = (answer.body as { detail?: string } | null)?.detail;
    if (answer.status === 401) throw new RemoteError(401, "The cloud no longer accepts this device's token: unlink it and link it again");
    if (answer.status === 404 && path.startsWith("/v1/sync")) throw new RemoteError(404, `${url} does not answer sync requests: is it an Endpoint Quality cloud deployment?`);
    throw new RemoteError(answer.status, detail ?? `${method} ${path} answered ${answer.status}`);
  }
}

function normalizeUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Invalid(`Not a URL: ${value}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Invalid("The cloud URL must be http(s)");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const message = (error: unknown) => error instanceof Error ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message) : String(error);

function seal(key: Buffer, plain: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `e2e1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

function open(key: Buffer, sealed: string, context: string) {
  if (!sealed.startsWith("e2e1.")) throw new Error("Unknown format");
  const raw = Buffer.from(sealed.slice(5), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** A sealed credential belongs to one workspace and one environment's role: it opens nowhere else. */
const credentialContext = (link: SyncLinkRow, syncId: string) => `credential:${link.remoteWorkspaceId}:${syncId}`;

const labelFor = (item: PushItem) => item.type === "project" ? String(item.data.name ?? "") : item.type === "environment" ? String(item.data.name ?? "") : item.id;

/** Requests of at most PUSH_ITEMS entities and about PUSH_BYTES; a bigger entity goes alone. */
function batches<T extends { size: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length && (current.length >= PUSH_ITEMS || bytes + item.size > PUSH_BYTES)) { out.push(current); current = []; bytes = 0; }
    current.push(item);
    bytes += item.size;
  }
  if (current.length) out.push(current);
  return out;
}
