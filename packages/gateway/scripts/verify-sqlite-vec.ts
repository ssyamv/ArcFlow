import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

// Bun's bundled SQLite disables extension loading; point to a system SQLite that supports it.
// On macOS (Homebrew): /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib
// Override via SQLITE_LIB_PATH env var if needed.
const customPath =
  process.env.SQLITE_LIB_PATH ||
  (process.platform === "darwin" ? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib" : undefined);
if (customPath) {
  Database.setCustomSQLite(customPath);
}

const db = new Database(":memory:");
sqliteVec.load(db);
const [{ version }] = db.prepare("select vec_version() as version").all() as { version: string }[];
console.log("sqlite-vec version:", version);
db.close();
