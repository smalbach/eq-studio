/**
 * The tables, as TypeORM `EntitySchema`s rather than decorated classes: no decorator metadata
 * is needed, and the row types stay plain objects the domain can use without TypeORM.
 *
 * Portable on purpose — the same schemas run on SQLite (local) and PostgreSQL (cloud): ids are
 * text UUIDv7, timestamps are ISO strings, JSON is `simple-json` text. Every synced row carries
 * `rev`, `updated_at` and `deleted_at` (soft delete) from the start; sync (P7) builds on them.
 */
import { EntitySchema } from "typeorm";
import type { EnvironmentConfig, LoadConfig, ProjectConfig } from "@eq/runner-core";

export type WorkspaceRow = { id: string; name: string; createdAt: string };

/** The project's configuration without its operations: those come from its active spec version. */
export type StoredConfig = Omit<ProjectConfig, "operations" | "name" | "contractVersion">;

export type ProjectRow = {
  id: string;
  /** The workspace's change counter when this row was last written (see `shared/sync-seq.ts`). */
  syncSeq?: number;
  workspaceId: string;
  slug: string;
  name: string;
  config: StoredConfig;
  load: LoadConfig | null;
  activeSpecVersionId: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type SpecVersionRow = {
  id: string;
  syncSeq?: number;
  workspaceId: string;
  projectId: string;
  hash: string;
  sourceKind: "url" | "inline" | "project-file";
  sourceUrl: string | null;
  openapiVersion: string | null;
  title: string | null;
  version: string | null;
  document: string | null;
  operationCount: number;
  createdAt: string;
};

export type OperationRow = {
  id: string;
  specVersionId: string;
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  statuses: number[];
  parameters: string[];
  internal: boolean;
  position: number;
};

export type EnvironmentRow = {
  id: string;
  /** The workspace's change counter when this row was last written (see `shared/sync-seq.ts`). */
  syncSeq?: number;
  workspaceId: string;
  projectId: string;
  key: string;
  name: string;
  baseUrl: string;
  specUrl: string | null;
  seeded: boolean | null;
  writesAllowed: boolean | null;
  enforceLatency: boolean | null;
  authEnabled: boolean | null;
  description: EnvironmentConfig["description"] | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const id = { type: "varchar", length: 36, primary: true } as const;
const ref = { type: "varchar", length: 36 } as const;
const stamp = { type: "varchar", length: 32 } as const;
const nullableBool = { type: "boolean", nullable: true } as const;
const syncSeq = { type: "integer", name: "sync_seq", default: 0 } as const;

export const WorkspaceEntity = new EntitySchema<WorkspaceRow>({
  name: "Workspace", tableName: "workspaces",
  columns: { id, name: { type: "varchar", length: 200 }, createdAt: { ...stamp, name: "created_at" } },
});

export const ProjectEntity = new EntitySchema<ProjectRow>({
  name: "Project", tableName: "projects",
  columns: {
    id,
    syncSeq,
    workspaceId: { ...ref, name: "workspace_id" },
    slug: { type: "varchar", length: 120 },
    name: { type: "varchar", length: 200 },
    config: { type: "simple-json" },
    load: { type: "simple-json", nullable: true },
    activeSpecVersionId: { ...ref, name: "active_spec_version_id", nullable: true },
    rev: { type: "integer" },
    createdAt: { ...stamp, name: "created_at" },
    updatedAt: { ...stamp, name: "updated_at" },
    deletedAt: { ...stamp, name: "deleted_at", nullable: true },
  },
});

export const SpecVersionEntity = new EntitySchema<SpecVersionRow>({
  name: "SpecVersion", tableName: "spec_versions",
  columns: {
    id,
    syncSeq,
    workspaceId: { ...ref, name: "workspace_id" },
    projectId: { ...ref, name: "project_id" },
    hash: { type: "varchar", length: 64 },
    sourceKind: { type: "varchar", length: 20, name: "source_kind" },
    sourceUrl: { type: "text", name: "source_url", nullable: true },
    openapiVersion: { type: "varchar", length: 20, name: "openapi_version", nullable: true },
    title: { type: "text", nullable: true },
    version: { type: "varchar", length: 100, nullable: true },
    document: { type: "text", nullable: true },
    operationCount: { type: "integer", name: "operation_count" },
    createdAt: { ...stamp, name: "created_at" },
  },
});

export const OperationEntity = new EntitySchema<OperationRow>({
  name: "Operation", tableName: "operations",
  columns: {
    id,
    specVersionId: { ...ref, name: "spec_version_id" },
    operationId: { type: "varchar", length: 200, name: "operation_id" },
    method: { type: "varchar", length: 10 },
    path: { type: "text" },
    tag: { type: "varchar", length: 200 },
    summary: { type: "text" },
    statuses: { type: "simple-json" },
    parameters: { type: "simple-json" },
    internal: { type: "boolean" },
    position: { type: "integer" },
  },
});

export const EnvironmentEntity = new EntitySchema<EnvironmentRow>({
  name: "Environment", tableName: "environments",
  columns: {
    id,
    syncSeq,
    workspaceId: { ...ref, name: "workspace_id" },
    projectId: { ...ref, name: "project_id" },
    key: { type: "varchar", length: 120 },
    name: { type: "varchar", length: 200 },
    baseUrl: { type: "text", name: "base_url" },
    specUrl: { type: "text", name: "spec_url", nullable: true },
    seeded: nullableBool,
    writesAllowed: { ...nullableBool, name: "writes_allowed" },
    enforceLatency: { ...nullableBool, name: "enforce_latency" },
    authEnabled: { ...nullableBool, name: "auth_enabled" },
    description: { type: "simple-json", nullable: true },
    rev: { type: "integer" },
    createdAt: { ...stamp, name: "created_at" },
    updatedAt: { ...stamp, name: "updated_at" },
    deletedAt: { ...stamp, name: "deleted_at", nullable: true },
  },
});

export type RunKind = "functional" | "load";
export type RunStatus = "queued" | "running" | "cancelling" | "passed" | "failed" | "cancelled" | "interrupted" | "error";
export type RunTotals = { total: number; passed: number; failed: number; blocked: number; completed: number };

/**
 * A run: append-only once finished. `plan` is everything needed to run it again (and what it
 * was run with); `report` is the load test's report.
 */
export type RunRow = {
  id: string;
  syncSeq?: number;
  workspaceId: string;
  projectId: string;
  environmentId: string;
  specVersionId: string | null;
  kind: RunKind;
  status: RunStatus;
  scope: string;
  plan: Record<string, unknown>;
  totals: RunTotals;
  report: Record<string, unknown> | null;
  error: string | null;
  triggeredBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

export type CaseStatus = "queued" | "running" | "passed" | "failed" | "blocked" | "skipped";
export type StepRecord = { step?: string; method: string; url: string; status: number | null; ok: boolean; durationMs: number; latency?: { p95: number; budgetMs: number | null }; assertions: { label: string; pass: boolean; detail: string; informative?: boolean }[]; requestBody?: unknown; responseBody?: unknown; error?: string };

export type RunCaseRow = {
  id: string;
  runId: string;
  position: number;
  operationId: string;
  scenarioId: string;
  name: string;
  method: string;
  path: string;
  expectedStatus: number;
  status: CaseStatus;
  durationMs: number | null;
  steps: StepRecord[] | null;
};

export type CredentialRole = "primary" | "insufficient" | "alternate";
export type CredentialKind = "bearer" | "api_key" | "basic" | "oauth2_client_credentials";

/**
 * A credential of an environment, one per role. The secret is encrypted (AES-256-GCM) with a key
 * that never leaves the machine (local) or the deployment (cloud); reads only ever return its
 * last four characters. Credentials are not soft-deleted: a deleted secret is gone.
 */
export type CredentialRow = {
  id: string;
  syncSeq?: number;
  workspaceId: string;
  environmentId: string;
  role: CredentialRole;
  kind: CredentialKind;
  headerName: string | null;
  username: string | null;
  tokenUrl: string | null;
  clientId: string | null;
  scope: string | null;
  secret: string | null;
  lastFour: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
};

export const RunEntity = new EntitySchema<RunRow>({
  name: "Run", tableName: "runs",
  columns: {
    id,
    syncSeq,
    workspaceId: { ...ref, name: "workspace_id" },
    projectId: { ...ref, name: "project_id" },
    environmentId: { ...ref, name: "environment_id" },
    specVersionId: { ...ref, name: "spec_version_id", nullable: true },
    kind: { type: "varchar", length: 20 },
    status: { type: "varchar", length: 20 },
    scope: { type: "varchar", length: 300 },
    plan: { type: "simple-json" },
    totals: { type: "simple-json" },
    report: { type: "simple-json", nullable: true },
    error: { type: "text", nullable: true },
    triggeredBy: { type: "varchar", length: 120, name: "triggered_by" },
    createdAt: { ...stamp, name: "created_at" },
    startedAt: { ...stamp, name: "started_at", nullable: true },
    finishedAt: { ...stamp, name: "finished_at", nullable: true },
    durationMs: { type: "integer", name: "duration_ms", nullable: true },
  },
});

export const RunCaseEntity = new EntitySchema<RunCaseRow>({
  name: "RunCase", tableName: "run_cases",
  columns: {
    id,
    runId: { ...ref, name: "run_id" },
    position: { type: "integer" },
    operationId: { type: "varchar", length: 200, name: "operation_id" },
    scenarioId: { type: "varchar", length: 200, name: "scenario_id" },
    name: { type: "text" },
    method: { type: "varchar", length: 10 },
    path: { type: "text" },
    expectedStatus: { type: "integer", name: "expected_status" },
    status: { type: "varchar", length: 20 },
    durationMs: { type: "integer", name: "duration_ms", nullable: true },
    steps: { type: "simple-json", nullable: true },
  },
});

export const CredentialEntity = new EntitySchema<CredentialRow>({
  name: "Credential", tableName: "credentials",
  columns: {
    id,
    syncSeq,
    workspaceId: { ...ref, name: "workspace_id" },
    environmentId: { ...ref, name: "environment_id" },
    role: { type: "varchar", length: 20 },
    kind: { type: "varchar", length: 40 },
    headerName: { type: "varchar", length: 200, name: "header_name", nullable: true },
    username: { type: "text", nullable: true },
    tokenUrl: { type: "text", name: "token_url", nullable: true },
    clientId: { type: "text", name: "client_id", nullable: true },
    scope: { type: "text", nullable: true },
    secret: { type: "text", nullable: true },
    lastFour: { type: "varchar", length: 8, name: "last_four", nullable: true },
    rev: { type: "integer" },
    createdAt: { ...stamp, name: "created_at" },
    updatedAt: { ...stamp, name: "updated_at" },
  },
});

export type Role = "viewer" | "editor" | "admin" | "owner";
export type UserRow = { id: string; email: string; name: string; passwordHash: string; status: "active" | "disabled"; createdAt: string; updatedAt: string };
export type MembershipRow = { id: string; workspaceId: string; userId: string; role: Role; createdAt: string };
export type InvitationRow = { id: string; workspaceId: string; email: string; role: Role; tokenHash: string; expiresAt: string; acceptedAt: string | null; createdBy: string; createdAt: string };
export type RefreshTokenRow = { id: string; userId: string; familyId: string; tokenHash: string; expiresAt: string; revokedAt: string | null; replacedBy: string | null; createdAt: string };
export type ApiTokenRow = { id: string; workspaceId: string; kind?: "api" | "device"; userId?: string | null; name: string; tokenHash: string; prefix: string; role: Role; createdBy: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

export const UserEntity = new EntitySchema<UserRow>({
  name: "User", tableName: "users",
  columns: { id, email: { type: "varchar", length: 320 }, name: { type: "varchar", length: 200 }, passwordHash: { type: "varchar", length: 300, name: "password_hash" }, status: { type: "varchar", length: 20 }, createdAt: { ...stamp, name: "created_at" }, updatedAt: { ...stamp, name: "updated_at" } },
});
export const MembershipEntity = new EntitySchema<MembershipRow>({
  name: "Membership", tableName: "memberships",
  columns: { id, workspaceId: { ...ref, name: "workspace_id" }, userId: { ...ref, name: "user_id" }, role: { type: "varchar", length: 20 }, createdAt: { ...stamp, name: "created_at" } },
});
export const InvitationEntity = new EntitySchema<InvitationRow>({
  name: "Invitation", tableName: "invitations",
  columns: { id, workspaceId: { ...ref, name: "workspace_id" }, email: { type: "varchar", length: 320 }, role: { type: "varchar", length: 20 }, tokenHash: { type: "varchar", length: 64, name: "token_hash" }, expiresAt: { ...stamp, name: "expires_at" }, acceptedAt: { ...stamp, name: "accepted_at", nullable: true }, createdBy: { ...ref, name: "created_by" }, createdAt: { ...stamp, name: "created_at" } },
});
export const RefreshTokenEntity = new EntitySchema<RefreshTokenRow>({
  name: "RefreshToken", tableName: "refresh_tokens",
  columns: { id, userId: { ...ref, name: "user_id" }, familyId: { ...ref, name: "family_id" }, tokenHash: { type: "varchar", length: 64, name: "token_hash" }, expiresAt: { ...stamp, name: "expires_at" }, revokedAt: { ...stamp, name: "revoked_at", nullable: true }, replacedBy: { ...ref, name: "replaced_by", nullable: true }, createdAt: { ...stamp, name: "created_at" } },
});
export const ApiTokenEntity = new EntitySchema<ApiTokenRow>({
  name: "ApiToken", tableName: "api_tokens",
  columns: { id, workspaceId: { ...ref, name: "workspace_id" }, kind: { type: "varchar", length: 20, default: "api" }, userId: { ...ref, name: "user_id", nullable: true }, name: { type: "varchar", length: 200 }, tokenHash: { type: "varchar", length: 64, name: "token_hash" }, prefix: { type: "varchar", length: 16 }, role: { type: "varchar", length: 20 }, createdBy: { ...ref, name: "created_by" }, lastUsedAt: { ...stamp, name: "last_used_at", nullable: true }, expiresAt: { ...stamp, name: "expires_at", nullable: true }, revokedAt: { ...stamp, name: "revoked_at", nullable: true }, createdAt: { ...stamp, name: "created_at" } },
});

export type SyncType = "spec" | "project" | "environment" | "credential" | "run";
/** What the cloud keeps without reading it: end-to-end encrypted credentials, the key check. */
export type SyncObjectRow = { id: string; workspaceId: string; type: string; data: Record<string, unknown>; rev: number; syncSeq: number; updatedAt: string };
export type SyncAliasRow = { workspaceId: string; type: string; fromId: string; toId: string; createdAt: string };
export type SyncConflictRow = { id: string; workspaceId: string; type: SyncType; entityId: string; label: string; field: string; mine: unknown; theirs: unknown; device: string; createdAt: string; resolvedAt: string | null; resolution: "mine" | "theirs" | null };
/** On a device: what it last agreed with the cloud about one entity. `shadow` is the base of the next merge. */
export type SyncStateRow = { type: SyncType; entityId: string; localSeq: number; remoteRev: number; shadow: Record<string, unknown> };
export type SyncLinkRow = {
  id: string; url: string; remoteWorkspaceId: string | null; remoteWorkspaceName: string | null; deviceId: string; deviceName: string;
  /** The device's token, encrypted with the local key. */
  token: string | null; cursor: number; includeRuns: boolean; projects: string[] | null;
  /** The end-to-end key derived from the passphrase, encrypted with the local key; null when secrets stay here. */
  secretsKey: string | null;
  /** A sign-in in progress: the device code (encrypted) and what the browser shows. */
  pending: { deviceCode: string; userCode: string; verificationUri: string; expiresAt: string; interval: number } | null;
  /** Conflicts resolved here that the cloud has not heard about yet. */
  resolved: string[] | null;
  lastSyncAt: string | null; lastError: string | null; lastResult: Record<string, unknown> | null; createdAt: string;
};
export type DeviceCodeRow = { id: string; deviceCodeHash: string; userCode: string; name: string; status: "pending" | "approved" | "denied" | "used"; workspaceId: string | null; userId: string | null; expiresAt: string; createdAt: string };

export const SyncObjectEntity = new EntitySchema<SyncObjectRow>({
  name: "SyncObject", tableName: "sync_objects",
  columns: { id: { type: "varchar", length: 120, primary: true }, workspaceId: { ...ref, name: "workspace_id", primary: true }, type: { type: "varchar", length: 20, primary: true }, data: { type: "simple-json" }, rev: { type: "integer" }, syncSeq: { type: "integer", name: "sync_seq" }, updatedAt: { ...stamp, name: "updated_at" } },
});
export const SyncAliasEntity = new EntitySchema<SyncAliasRow>({
  name: "SyncAlias", tableName: "sync_aliases",
  columns: { workspaceId: { ...ref, name: "workspace_id", primary: true }, type: { type: "varchar", length: 20, primary: true }, fromId: { ...ref, name: "from_id", primary: true }, toId: { ...ref, name: "to_id" }, createdAt: { ...stamp, name: "created_at" } },
});
export const SyncConflictEntity = new EntitySchema<SyncConflictRow>({
  name: "SyncConflict", tableName: "sync_conflicts",
  columns: { id, workspaceId: { ...ref, name: "workspace_id" }, type: { type: "varchar", length: 20 }, entityId: { type: "varchar", length: 120, name: "entity_id" }, label: { type: "varchar", length: 300 }, field: { type: "varchar", length: 200 }, mine: { type: "simple-json", nullable: true }, theirs: { type: "simple-json", nullable: true }, device: { type: "varchar", length: 200 }, createdAt: { ...stamp, name: "created_at" }, resolvedAt: { ...stamp, name: "resolved_at", nullable: true }, resolution: { type: "varchar", length: 20, nullable: true } },
});
export const SyncStateEntity = new EntitySchema<SyncStateRow>({
  name: "SyncState", tableName: "sync_state",
  columns: { type: { type: "varchar", length: 20, primary: true }, entityId: { type: "varchar", length: 120, name: "entity_id", primary: true }, localSeq: { type: "integer", name: "local_seq" }, remoteRev: { type: "integer", name: "remote_rev" }, shadow: { type: "simple-json" } },
});
export const SyncLinkEntity = new EntitySchema<SyncLinkRow>({
  name: "SyncLink", tableName: "sync_link",
  columns: {
    id, url: { type: "text" }, remoteWorkspaceId: { ...ref, name: "remote_workspace_id", nullable: true }, remoteWorkspaceName: { type: "varchar", length: 200, name: "remote_workspace_name", nullable: true },
    deviceId: { ...ref, name: "device_id" }, deviceName: { type: "varchar", length: 200, name: "device_name" }, token: { type: "text", nullable: true }, cursor: { type: "integer" },
    includeRuns: { type: "boolean", name: "include_runs" }, projects: { type: "simple-json", nullable: true }, secretsKey: { type: "text", name: "secrets_key", nullable: true },
    pending: { type: "simple-json", nullable: true }, resolved: { type: "simple-json", nullable: true }, lastSyncAt: { ...stamp, name: "last_sync_at", nullable: true },
    lastError: { type: "text", name: "last_error", nullable: true }, lastResult: { type: "simple-json", name: "last_result", nullable: true }, createdAt: { ...stamp, name: "created_at" },
  },
});
export const DeviceCodeEntity = new EntitySchema<DeviceCodeRow>({
  name: "DeviceCode", tableName: "device_codes",
  columns: { id, deviceCodeHash: { type: "varchar", length: 64, name: "device_code_hash" }, userCode: { type: "varchar", length: 16, name: "user_code" }, name: { type: "varchar", length: 200 }, status: { type: "varchar", length: 20 }, workspaceId: { ...ref, name: "workspace_id", nullable: true }, userId: { ...ref, name: "user_id", nullable: true }, expiresAt: { ...stamp, name: "expires_at" }, createdAt: { ...stamp, name: "created_at" } },
});

/**
 * A run started by the clock: a cron expression (UTC) and the plan of a functional or load run.
 * `nextRunAt` is also the claim: a process fires a schedule only if it moves it from the value it
 * read, so two API processes never start the same occurrence twice.
 */
export type ScheduleRow = {
  id: string; workspaceId: string; projectId: string; environmentId: string; name: string; cron: string; kind: RunKind;
  plan: Record<string, unknown>; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastRunId: string | null; lastError: string | null;
  createdBy: string; rev: number; createdAt: string; updatedAt: string;
};

export type NotificationKind = "webhook" | "slack" | "email";
/** `change`: only when the verdict flips (passed → failed, failed → passed). */
export type NotificationTrigger = "always" | "change";

/** Where a finished run is announced. The URL and the signing secret are encrypted like credentials. */
export type NotificationTargetRow = {
  id: string; workspaceId: string; projectId: string; name: string; kind: NotificationKind; notifyOn: NotificationTrigger; enabled: boolean;
  url: string | null; urlHint: string | null; signingSecret: string | null; recipients: string[] | null;
  lastSentAt: string | null; lastStatus: "ok" | "failed" | null; lastError: string | null;
  rev: number; createdAt: string; updatedAt: string;
};

export const ScheduleEntity = new EntitySchema<ScheduleRow>({
  name: "Schedule", tableName: "schedules",
  columns: {
    id, workspaceId: { ...ref, name: "workspace_id" }, projectId: { ...ref, name: "project_id" }, environmentId: { ...ref, name: "environment_id" }, name: { type: "varchar", length: 200 }, cron: { type: "varchar", length: 120 }, kind: { type: "varchar", length: 20 },
    plan: { type: "simple-json" }, enabled: { type: "boolean" }, nextRunAt: { ...stamp, name: "next_run_at", nullable: true }, lastRunAt: { ...stamp, name: "last_run_at", nullable: true }, lastRunId: { ...ref, name: "last_run_id", nullable: true }, lastError: { type: "text", name: "last_error", nullable: true },
    createdBy: { type: "varchar", length: 120, name: "created_by" }, rev: { type: "integer" }, createdAt: { ...stamp, name: "created_at" }, updatedAt: { ...stamp, name: "updated_at" },
  },
});

export const NotificationTargetEntity = new EntitySchema<NotificationTargetRow>({
  name: "NotificationTarget", tableName: "notification_targets",
  columns: {
    id, workspaceId: { ...ref, name: "workspace_id" }, projectId: { ...ref, name: "project_id" }, name: { type: "varchar", length: 200 }, kind: { type: "varchar", length: 20 }, notifyOn: { type: "varchar", length: 20, name: "notify_on" }, enabled: { type: "boolean" },
    url: { type: "text", nullable: true }, urlHint: { type: "varchar", length: 300, name: "url_hint", nullable: true }, signingSecret: { type: "text", name: "signing_secret", nullable: true }, recipients: { type: "simple-json", nullable: true },
    lastSentAt: { ...stamp, name: "last_sent_at", nullable: true }, lastStatus: { type: "varchar", length: 20, name: "last_status", nullable: true }, lastError: { type: "text", name: "last_error", nullable: true },
    rev: { type: "integer" }, createdAt: { ...stamp, name: "created_at" }, updatedAt: { ...stamp, name: "updated_at" },
  },
});

export const ENTITIES = [ScheduleEntity, NotificationTargetEntity, SyncObjectEntity, SyncAliasEntity, SyncConflictEntity, SyncStateEntity, SyncLinkEntity, DeviceCodeEntity, UserEntity, MembershipEntity, InvitationEntity, RefreshTokenEntity, ApiTokenEntity, WorkspaceEntity, ProjectEntity, SpecVersionEntity, OperationEntity, EnvironmentEntity, RunEntity, RunCaseEntity, CredentialEntity];
