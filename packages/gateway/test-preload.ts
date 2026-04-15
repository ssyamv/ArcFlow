// Must run before any Database() is instantiated. Points bun:sqlite at a system
// SQLite build that supports dynamic extension loading (required by sqlite-vec).
import { Database } from "bun:sqlite";

if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      process.env.SQLITE_LIB_PATH ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    );
  } catch {
    // already set in a prior preload
  }
}
