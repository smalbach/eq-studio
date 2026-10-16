/**
 * The change counter of a workspace. Every write of a synced row takes the next number inside
 * its own transaction, so on PostgreSQL the counter's row stays locked until that transaction
 * commits: numbers become visible in the order they were taken, and "everything after N" never
 * skips a row that was still being written.
 */
import type { DataSource, EntityManager } from "typeorm";

function table(manager: EntityManager) {
  const schema = (manager.connection.options as { schema?: string }).schema;
  return schema ? `"${schema.replace(/"/g, "")}"."sync_counters"` : "sync_counters";
}

export async function nextSyncSeq(manager: EntityManager, workspaceId: string): Promise<number> {
  const postgres = manager.connection.options.type === "postgres";
  const name = table(manager);
  const rows: { value: number | string }[] = await manager.query(postgres
    ? `INSERT INTO ${name} (workspace_id, value) VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE SET value = ${name}.value + 1 RETURNING value`
    : `INSERT INTO ${name} (workspace_id, value) VALUES (?, 1) ON CONFLICT (workspace_id) DO UPDATE SET value = value + 1 RETURNING value`, [workspaceId]);
  return Number(rows[0].value);
}

/** Runs `write` in the given transaction, or in a new one, with the next number. */
export function withSyncSeq<T>(db: DataSource, tx: EntityManager | undefined, workspaceId: string, write: (manager: EntityManager, seq: number) => Promise<T>): Promise<T> {
  const run = async (manager: EntityManager) => write(manager, await nextSyncSeq(manager, workspaceId));
  return tx ? run(tx) : db.transaction(run);
}
