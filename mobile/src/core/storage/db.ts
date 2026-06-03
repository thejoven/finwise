/**
 * SQLite database handle (singleton).
 *
 * 为什么不用 Drizzle ORM:
 *   M4 spec 推荐 Drizzle, 但 Phase 1 只有 pending_signals 一张表, 查询都是单表
 *   CRUD. 引入 Drizzle 会拖 codegen 工具链 + 1MB+ bundle, 没收益. Phase 2 真有
 *   关联查询时再加, 那时已经有 commitments / refinements / gates 多表了.
 *
 * 持久化语义:
 *   - 进程重启后, pending 队列原样恢复
 *   - SQLite 是 truth, zustand 是只读 mirror (热加载入内存)
 *   - 所有 mutation 走 repo.upsert / repo.markFailed / repo.delete, 写完再更新 zustand
 */

import * as SQLite from "expo-sqlite";

const DB_NAME = "wiseflow.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await db.execAsync(`PRAGMA foreign_keys = ON;`);
  await applyMigrations(db);
  return db;
}

/**
 * Hand-rolled migration runner. SQLite has user_version pragma; bump it after
 * each schema change. Migrations are forward-only — no down().
 *
 * Adding a Phase 2 table? Append a new `if (version < N)` block + bump.
 */
async function applyMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version;`);
  let version = row?.user_version ?? 0;

  if (version < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`
        CREATE TABLE IF NOT EXISTS pending_signals (
          id            TEXT PRIMARY KEY NOT NULL,
          raw_text      TEXT NOT NULL,
          captured_at   TEXT NOT NULL,
          status        TEXT NOT NULL CHECK (status IN ('syncing','failed','exhausted')),
          error         TEXT,
          attempts      INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER NOT NULL DEFAULT 0,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pending_status_retry
          ON pending_signals (status, next_retry_at);
      `);
    });
    version = 1;
    await db.execAsync(`PRAGMA user_version = ${version};`);
  }

  if (version < 2) {
    // 加 project_id 到 pending_signals: 即使 App 重启, 重试时仍能把 signal
    // 提交到原 active project. 字段 nullable, 历史行兼容.
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`ALTER TABLE pending_signals ADD COLUMN project_id TEXT;`);
    });
    version = 2;
    await db.execAsync(`PRAGMA user_version = ${version};`);
  }
}
