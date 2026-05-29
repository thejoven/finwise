/**
 * pending_signals 表的 CRUD.
 *
 * 所有写入都用 repo, 这样 zustand store 是被动 mirror, 不会"漂"出 SQLite.
 */

import { getDB } from "./db";

export type PendingStatus = "syncing" | "failed" | "exhausted";

export interface PendingSignalRow {
  id: string;
  raw_text: string;
  captured_at: string;
  status: PendingStatus;
  error: string | null;
  attempts: number;
  /** Unix ms — sync queue won't retry before this. 0 = retry now. */
  next_retry_at: number;
  /** 提交时绑定的分类 id; null = 未分类 (即 "全部") */
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

interface DBRow {
  id: string;
  raw_text: string;
  captured_at: string;
  status: PendingStatus;
  error: string | null;
  attempts: number;
  next_retry_at: number;
  project_id: string | null;
  created_at: number;
  updated_at: number;
}

function toRow(r: DBRow): PendingSignalRow {
  return { ...r };
}

export async function listAll(): Promise<PendingSignalRow[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<DBRow>(`SELECT * FROM pending_signals ORDER BY captured_at DESC`);
  return rows.map(toRow);
}

export async function listEligibleForRetry(nowMs: number): Promise<PendingSignalRow[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<DBRow>(
    `SELECT * FROM pending_signals
     WHERE status = 'failed' AND next_retry_at <= ?
     ORDER BY captured_at ASC`,
    [nowMs],
  );
  return rows.map(toRow);
}

export async function upsertSyncing(input: {
  id: string;
  raw_text: string;
  captured_at: string;
  project_id?: string | null;
}): Promise<PendingSignalRow> {
  const db = await getDB();
  const now = Date.now();
  const projectID = input.project_id ?? null;
  await db.runAsync(
    `INSERT INTO pending_signals (id, raw_text, captured_at, status, error, attempts, next_retry_at, project_id, created_at, updated_at)
     VALUES (?, ?, ?, 'syncing', NULL, 0, 0, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status        = 'syncing',
       error         = NULL,
       next_retry_at = 0,
       project_id    = excluded.project_id,
       updated_at    = excluded.updated_at`,
    [input.id, input.raw_text, input.captured_at, projectID, now, now],
  );
  const row = await db.getFirstAsync<DBRow>(`SELECT * FROM pending_signals WHERE id = ?`, [input.id]);
  if (!row) throw new Error(`upsertSyncing: row not found after insert: ${input.id}`);
  return toRow(row);
}

export async function markFailed(id: string, error: string, maxAttempts: number): Promise<PendingSignalRow | null> {
  const db = await getDB();
  const now = Date.now();
  const existing = await db.getFirstAsync<DBRow>(`SELECT * FROM pending_signals WHERE id = ?`, [id]);
  if (!existing) return null;

  const attempts = existing.attempts + 1;
  const exhausted = attempts >= maxAttempts;
  const nextRetry = exhausted ? 0 : now + backoffMs(attempts);
  const status: PendingStatus = exhausted ? "exhausted" : "failed";

  await db.runAsync(
    `UPDATE pending_signals
        SET status        = ?,
            error         = ?,
            attempts      = ?,
            next_retry_at = ?,
            updated_at    = ?
      WHERE id = ?`,
    [status, error, attempts, nextRetry, now, id],
  );
  const updated = await db.getFirstAsync<DBRow>(`SELECT * FROM pending_signals WHERE id = ?`, [id]);
  return updated ? toRow(updated) : null;
}

/** User-initiated retry: reset attempts so it gets up to maxAttempts again. */
export async function resetForManualRetry(id: string): Promise<PendingSignalRow | null> {
  const db = await getDB();
  const now = Date.now();
  await db.runAsync(
    `UPDATE pending_signals
        SET status        = 'syncing',
            error         = NULL,
            attempts      = 0,
            next_retry_at = 0,
            updated_at    = ?
      WHERE id = ?`,
    [now, id],
  );
  const updated = await db.getFirstAsync<DBRow>(`SELECT * FROM pending_signals WHERE id = ?`, [id]);
  return updated ? toRow(updated) : null;
}

export async function deleteById(id: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM pending_signals WHERE id = ?`, [id]);
}

/**
 * Exponential backoff for sync retries.
 * attempt=1 → 2s, attempt=2 → 8s, attempt=3 → 32s.
 * Phase 1 caps at 3 attempts so we never actually reach the 32s wait —
 * but kept here for symmetry if Phase 2 raises maxAttempts.
 */
function backoffMs(attempt: number): number {
  const base = 2000;
  return base * Math.pow(4, attempt - 1);
}
