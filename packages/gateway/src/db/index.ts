import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    const dbPath =
      process.env.NODE_ENV === "test" ? ":memory:" : (process.env.DATABASE_PATH ?? "gateway.db");
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf-8");
    db.exec(schema);

    // Migrations — add columns that may not exist yet
    const cols = db.query("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("plane_workspace_slug")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN plane_workspace_slug TEXT");
    }
    if (!colNames.has("feishu_chat_id")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN feishu_chat_id TEXT");
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
