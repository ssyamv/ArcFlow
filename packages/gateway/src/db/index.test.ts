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
  db.exec(
    "INSERT INTO dispatch (id, workspace_id, skill, input_json, status, created_at, timeout_at) VALUES ('legacy-1', 'w', 'arcflow-code-gen', '{}', 'processing', 1111, NULL)",
  );
  db.close();
}

describe("db startup migration", () => {
  let closeDb: () => void;
  let getDb: () => Database;
  let prevNodeEnv: string | undefined;
  let hadNodeEnv = false;
  let prevDatabasePath: string | undefined;
  let hadDatabasePath = false;

  beforeEach(async () => {
    hadNodeEnv = Object.prototype.hasOwnProperty.call(process.env, "NODE_ENV");
    prevNodeEnv = process.env.NODE_ENV;
    hadDatabasePath = Object.prototype.hasOwnProperty.call(process.env, "DATABASE_PATH");
    prevDatabasePath = process.env.DATABASE_PATH;
    tempDir = mkdtempSync(join(tmpdir(), "arcflow-db-migration-"));
    dbPath = join(tempDir, "gateway.db");
    createOldDispatchDb(dbPath);
    process.env.DATABASE_PATH = dbPath;
    process.env.NODE_ENV = "development";

    const mod = await import(`./index?migration=${Date.now()}`);
    getDb = mod.getDb;
    closeDb = mod.closeDb;
  });

  afterEach(() => {
    closeDb();
    rmSync(tempDir, { recursive: true, force: true });
    if (hadNodeEnv) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (hadDatabasePath) {
      process.env.DATABASE_PATH = prevDatabasePath;
    } else {
      delete process.env.DATABASE_PATH;
    }
  });

  it("upgrades an old dispatch table without startup failure", async () => {
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

    const row = db
      .prepare(
        "SELECT status, started_at, last_callback_at, timeout_at, error_message, result_summary, callback_replay_count FROM dispatch WHERE id = 'legacy-1'",
      )
      .get() as {
      status: string;
      started_at: number | null;
      last_callback_at: number | null;
      timeout_at: number | null;
      error_message: string | null;
      result_summary: string | null;
      callback_replay_count: number;
    };
    expect(row.status).toBe("running");
    expect(row.started_at).toBe(1111);
    expect(row.last_callback_at).toBeNull();
    expect(row.timeout_at).toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.result_summary).toBeNull();
    expect(row.callback_replay_count).toBe(0);

    const { claimDispatchForCallback } = await import("./queries");
    const claimed = claimDispatchForCallback(db, "legacy-1", 2222, 5000);
    expect(claimed).toBe(true);
    const claimedRow = db
      .prepare(
        "SELECT status, started_at, last_callback_at, timeout_at, callback_replay_count FROM dispatch WHERE id = 'legacy-1'",
      )
      .get() as {
      status: string;
      started_at: number | null;
      last_callback_at: number | null;
      timeout_at: number | null;
      callback_replay_count: number;
    };
    expect(claimedRow.status).toBe("running");
    expect(claimedRow.started_at).toBe(1111);
    expect(claimedRow.last_callback_at).toBe(2222);
    expect(claimedRow.timeout_at).toBe(7222);
    expect(claimedRow.callback_replay_count).toBe(0);

    const index = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dispatch_source_execution'",
      )
      .get() as { name: string } | null;
    expect(index).not.toBeNull();
  });
});
