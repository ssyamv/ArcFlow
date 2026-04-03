import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    db = new Database(process.env.NODE_ENV === "test" ? ":memory:" : "gateway.db");
    db.exec("PRAGMA journal_mode = WAL;");
    const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf-8");
    db.exec(schema);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
