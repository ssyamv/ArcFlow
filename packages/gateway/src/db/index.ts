import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

let db: Database | null = null;

function migrateDispatchColumns(db: Database): void {
  const tableExists = db
    .query("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'dispatch'")
    .get() as { ok: number } | null;
  if (!tableExists) return;

  const columns = db.query("PRAGMA table_info(dispatch)").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  const migrations = [
    [
      "source_execution_id",
      "ALTER TABLE dispatch ADD COLUMN source_execution_id INTEGER REFERENCES workflow_execution(id) ON DELETE CASCADE",
    ],
    ["source_stage", "ALTER TABLE dispatch ADD COLUMN source_stage TEXT"],
    ["started_at", "ALTER TABLE dispatch ADD COLUMN started_at INTEGER"],
    ["last_callback_at", "ALTER TABLE dispatch ADD COLUMN last_callback_at INTEGER"],
    ["error_message", "ALTER TABLE dispatch ADD COLUMN error_message TEXT"],
    ["result_summary", "ALTER TABLE dispatch ADD COLUMN result_summary TEXT"],
    [
      "callback_replay_count",
      "ALTER TABLE dispatch ADD COLUMN callback_replay_count INTEGER NOT NULL DEFAULT 0",
    ],
  ] as const;

  for (const [columnName, sql] of migrations) {
    if (!columnNames.has(columnName)) {
      db.exec(sql);
    }
  }
}

export function getDb(): Database {
  if (!db) {
    const dbPath =
      process.env.NODE_ENV === "test" ? ":memory:" : (process.env.DATABASE_PATH ?? "gateway.db");
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    migrateDispatchColumns(db);
    const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf-8");
    db.exec(schema);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_dispatch_source_execution ON dispatch(source_execution_id, created_at)",
    );

    // Migrations — add columns that may not exist yet
    const cols = db.query("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("plane_workspace_slug")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN plane_workspace_slug TEXT");
    }
    if (!colNames.has("feishu_chat_id")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN feishu_chat_id TEXT");
    }
    // Drop legacy Dify columns if present (全量切 NanoClaw + sqlite-vec 后不再使用)
    if (colNames.has("dify_dataset_id")) {
      db.exec("ALTER TABLE workspaces DROP COLUMN dify_dataset_id");
    }
    if (colNames.has("dify_rag_api_key")) {
      db.exec("ALTER TABLE workspaces DROP COLUMN dify_rag_api_key");
    }
    const convCols = db.query("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    if (convCols.some((c) => c.name === "dify_conversation_id")) {
      db.exec("ALTER TABLE conversations DROP COLUMN dify_conversation_id");
    }
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
