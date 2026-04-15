import { Database } from "bun:sqlite";
import { getConfig } from "../src/config";
import { createEmbeddingClient } from "../src/services/llm-embedding";
import { createRagIndex } from "../src/services/rag-index";
import { createGitAdapter } from "../src/services/rag-git-adapter";

// Ensure sqlite-vec extension can load on macOS
if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      process.env.SQLITE_LIB_PATH ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    );
  } catch {
    // already set
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sqliteVec = require("sqlite-vec") as typeof import("sqlite-vec");

const cfg = getConfig();
const db = new Database(cfg.ragDbPath);
sqliteVec.load(db);
db.exec(`
  CREATE TABLE IF NOT EXISTS rag_docs (
    workspace_id TEXT NOT NULL,
    doc_path TEXT NOT NULL,
    git_sha TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, doc_path)
  );
  CREATE TABLE IF NOT EXISTS rag_chunk_meta (
    chunk_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    doc_path TEXT NOT NULL,
    heading TEXT,
    content TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rag_chunk_meta_doc ON rag_chunk_meta(workspace_id, doc_path);
  CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING vec0(
    chunk_id TEXT PRIMARY KEY,
    workspace_id TEXT PARTITION KEY,
    embedding FLOAT[${cfg.ragEmbeddingDim}]
  )
`);

const embedder = createEmbeddingClient({
  apiKey: cfg.siliconflowApiKey,
  baseUrl: cfg.siliconflowBaseUrl,
  model: cfg.ragEmbeddingModel,
  dim: cfg.ragEmbeddingDim,
});
const idx = createRagIndex({ db, embedder, dim: cfg.ragEmbeddingDim });

// Single workspace assumption; set BOOTSTRAP_WORKSPACE_ID to override.
const workspaceId = process.env.BOOTSTRAP_WORKSPACE_ID || "default";
const gitRoot = process.env.BOOTSTRAP_GIT_ROOT || "./docs";
const git = createGitAdapter({
  rootDir: gitRoot,
  globs: ["prd/**/*.md", "tech-design/**/*.md", "api/**/*.yaml", "arch/**/*.md"],
});

console.log(`[bootstrap] workspace=${workspaceId} root=${gitRoot}`);
await idx.syncAll({ workspaceId, git });
console.log("[bootstrap] done");
db.close();
