import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tempDir = "";
let dbPath = "";

function createOldDispatchDb(path: string) {
  const db = new Database(path);
  const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf-8");
  db.exec(schema);
  db.exec(`
    DROP TABLE dispatch;
    CREATE TABLE dispatch (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      input_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      plane_issue_id TEXT,
      timeout_at INTEGER
    );
  `);
  db.close();
}

process.env.NODE_ENV = "development";

describe("db startup migration", () => {
  let closeDb: () => void;
  let getDb: () => Database;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "arcflow-db-migration-"));
    dbPath = join(tempDir, "gateway.db");
    createOldDispatchDb(dbPath);
    process.env.DATABASE_PATH = dbPath;

    const mod = await import("./index");
    getDb = mod.getDb;
    closeDb = mod.closeDb;
  });

  afterEach(() => {
    closeDb();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("upgrades an old dispatch table without startup failure", () => {
    const db = getDb();
    const columns = db.prepare("PRAGMA table_info(dispatch)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));

    expect(names.has("source_execution_id")).toBe(true);
    expect(names.has("source_stage")).toBe(true);
    expect(names.has("started_at")).toBe(true);
    expect(names.has("last_callback_at")).toBe(true);
    expect(names.has("error_message")).toBe(true);
    expect(names.has("result_summary")).toBe(true);
    expect(names.has("callback_replay_count")).toBe(true);

    const index = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dispatch_source_execution'",
      )
      .get() as { name: string } | null;
    expect(index).not.toBeNull();
  });
});
