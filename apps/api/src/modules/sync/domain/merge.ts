/**
 * The rules of sync, without a database: what each kind of entity is made of, who may change
 * it, and how two versions of it become one.
 *
 * An entity travels as a snapshot (`data`): plain JSON, without workspace or change numbers.
 * Snapshots are compared field by field. A project's configuration counts as one field per
 * section (`config.bodies`, `config.budgets`, …): two devices that edit different sections
 * both keep their change.
 *
 * The merge is three-way. `base` is the last version both sides agreed on, `theirs` is the
 * cloud's current one, `mine` the device's. A field only one side changed takes that side's
 * value; a field both changed to the same value is no conflict; a field both changed to
 * different values keeps the cloud's value and becomes a conflict someone resolves — never a
 * silent overwrite.
 */

export type SyncType = "spec" | "project" | "environment" | "credential" | "run";
export type Role = "viewer" | "editor" | "admin" | "owner";
export type Snapshot = Record<string, unknown>;

/** The order changes are applied in: what others point at goes first. */
export const SYNC_ORDER: SyncType[] = ["spec", "project", "environment", "credential", "run"];
export const SYNC_TYPES = new Set<string>(SYNC_ORDER);

/** Contracts and runs never change once written: there is nothing to merge. */
export const IMMUTABLE = new Set<SyncType>(["spec", "run"]);

/** What a push of each kind needs — the same as changing it through the API. */
export const REQUIRED_ROLE: Record<SyncType, Role> = { spec: "editor", project: "editor", environment: "admin", credential: "admin", run: "editor" };

const CONFIG = "config.";

/** JSON with sorted keys: two equal values print the same. */
export function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

/** An end-to-end encrypted value is compared by its tag: the ciphertext differs every time. */
function comparable(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && "tag" in value && "sealed" in value) return (value as { tag: unknown }).tag;
  return value;
}

export const same = (a: unknown, b: unknown) => stable(comparable(a)) === stable(comparable(b));

/** A snapshot as the fields that merge independently. */
export function fieldsOf(type: SyncType, data: Snapshot): Record<string, unknown> {
  if (type === "credential") return { environmentId: data.environmentId, role: data.role, secret: { tag: data.tag, sealed: data.sealed } };
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (type === "project" && key === "config" && value && typeof value === "object") for (const [section, item] of Object.entries(value)) fields[`${CONFIG}${section}`] = item;
    else fields[key] = value;
  }
  return fields;
}

export function fromFields(type: SyncType, fields: Record<string, unknown>): Snapshot {
  if (type === "credential") {
    const secret = (fields.secret ?? {}) as { tag?: unknown; sealed?: unknown };
    return { environmentId: fields.environmentId, role: fields.role, tag: secret.tag, sealed: secret.sealed };
  }
  const data: Snapshot = {};
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (type === "project" && key.startsWith(CONFIG)) { if (value !== undefined) config[key.slice(CONFIG.length)] = value; }
    else data[key] = value;
  }
  if (type === "project") data.config = config;
  return data;
}

/** Equal field by field (an encrypted secret by its tag). */
export function sameSnapshot(type: SyncType, a: Snapshot, b: Snapshot) {
  const left = fieldsOf(type, a);
  const right = fieldsOf(type, b);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every((field) => same(left[field], right[field]));
}

export type FieldConflict = { field: string; mine: unknown; theirs: unknown };
export type MergeResult = { data: Snapshot; conflicts: FieldConflict[]; changed: boolean };

/**
 * Three-way merge. `changed` says whether the device brought anything the cloud did not have.
 * Without a base (the device lost the answer to an earlier push) the device's version is taken
 * whole, as when nothing happened in between.
 */
export function merge(type: SyncType, base: Snapshot | null, theirs: Snapshot, mine: Snapshot): MergeResult {
  if (!base) return { data: mine, conflicts: [], changed: !sameSnapshot(type, theirs, mine) };
  const b = fieldsOf(type, base);
  const t = fieldsOf(type, theirs);
  const m = fieldsOf(type, mine);
  const result: Record<string, unknown> = { ...t };
  const conflicts: FieldConflict[] = [];
  let changed = false;
  for (const field of new Set([...Object.keys(b), ...Object.keys(t), ...Object.keys(m)])) {
    const mineChanged = !same(m[field], b[field]);
    if (!mineChanged) continue;
    const theirsChanged = !same(t[field], b[field]);
    if (!theirsChanged) { result[field] = m[field]; changed = true; continue; }
    if (same(m[field], t[field])) continue;
    conflicts.push({ field, mine: m[field] ?? null, theirs: t[field] ?? null });
  }
  return { data: fromFields(type, result), conflicts, changed };
}

/** One field of a snapshot, set: how a conflict is resolved in favour of one side. */
export function withField(type: SyncType, data: Snapshot, field: string, value: unknown): Snapshot {
  return fromFields(type, { ...fieldsOf(type, data), [field]: value });
}

/** What a person recognises the entity by, in the conflicts list. */
export function labelOf(type: SyncType, data: Snapshot): string {
  if (type === "project") return String(data.name ?? data.slug ?? "");
  if (type === "environment") return `${String(data.name ?? data.key ?? "")} (${String(data.baseUrl ?? "")})`;
  if (type === "credential") return String(data.role ?? "");
  return String(data.title ?? data.scope ?? "");
}

/** The project an entity belongs to — what "sync only these projects" filters by. */
export function projectOf(type: SyncType, id: string, data: Snapshot): string | null {
  if (type === "project") return id;
  return typeof data.projectId === "string" ? data.projectId : null;
}
