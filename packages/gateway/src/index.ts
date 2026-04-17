import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConfig } from "./config";
import { getDb } from "./db";
import { requestLogger } from "./middleware/logger";
import { healthRoutes } from "./routes/health";
import { createWebhookRoutes } from "./routes/webhook";
import { apiRoutes } from "./routes/api";
import { authRoutes } from "./routes/auth";
import { conversationRoutes } from "./routes/conversations";
import { workspaceRoutes } from "./routes/workspaces";
import { planeProxyRoutes } from "./routes/plane-proxy";
import { docsRoutes } from "./routes/docs";
import { arcflowToolRoutes } from "./routes/arcflow-tools";
import { startScheduler } from "./scheduler";
import { ragRoutes } from "./routes/rag";
import { callbackRoutes } from "./routes/workflow-callback";
import { createEmbeddingClient } from "./services/llm-embedding";
import { createRagIndex } from "./services/rag-index";
import { createRagSearch } from "./services/rag-search";
import { createGitAdapter } from "./services/rag-git-adapter";
import { createCallbackHandler } from "./services/workflow-callback";
import { createScheduler } from "./services/scheduler";
import { triggerWorkflow } from "./services/workflow";
import type { WorkflowDispatchStatus } from "./types";

// ── sqlite-vec: must call setCustomSQLite before any Database() on macOS ──────
if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      process.env.SQLITE_LIB_PATH ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    );
  } catch {
    // already set (e.g. by test-preload.ts)
  }
}

const config = getConfig();

// ── Main gateway DB ────────────────────────────────────────────────────────────
getDb();

// ── RAG DB (separate file, loaded with sqlite-vec) ────────────────────────────
let ragDb: Database | null = null;
let ragScheduler: ReturnType<typeof createScheduler> | null = null;

if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqliteVec = require("sqlite-vec") as typeof import("sqlite-vec");
  ragDb = new Database(config.ragDbPath);
  sqliteVec.load(ragDb);
  ragDb.exec(`
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
      embedding FLOAT[${config.ragEmbeddingDim}]
    )
  `);
  console.log(`[rag] db opened: ${config.ragDbPath}, dim=${config.ragEmbeddingDim}`);
}

export const app = new Hono();

// 全局中间件
app.use("*", requestLogger);

// CORS for API routes (Web frontend access)
app.use("/api/*", cors());

// 挂载路由
app.route("/", healthRoutes);
app.route("/auth", authRoutes);
app.route("/", authRoutes); // for /api/auth/me
app.route("/webhook", createWebhookRoutes());
app.route("/api", apiRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/plane", planeProxyRoutes);
app.route("/api/docs", docsRoutes);
app.route("/api/arcflow", arcflowToolRoutes);

// ── RAG + callback routes ──────────────────────────────────────────────────────
const systemSecret = process.env.SYSTEM_SECRET ?? process.env.NANOCLAW_DISPATCH_SECRET ?? "";

if (ragDb) {
  const embedder = createEmbeddingClient({
    apiKey: config.siliconflowApiKey,
    baseUrl: config.siliconflowBaseUrl,
    model: config.ragEmbeddingModel,
    dim: config.ragEmbeddingDim,
  });
  const ragSearch = createRagSearch({ db: ragDb, embedder });

  app.route("/api/rag", ragRoutes({ search: ragSearch, systemSecret }));
  console.log("[rag] /api/rag/search mounted");

  // Incremental RAG sync scheduler
  if (config.ragSyncIntervalMs > 0 && process.env.RAG_GIT_ROOT) {
    const ragIndex = createRagIndex({ db: ragDb, embedder, dim: config.ragEmbeddingDim });
    const gitAdapter = createGitAdapter({
      rootDir: process.env.RAG_GIT_ROOT,
      // Index the full docs repo so project overviews and general knowledge
      // pages are available to workspace Q&A, not only PRD/tech/API artifacts.
      globs: ["**/*.md", "**/*.yaml", "**/*.yml"],
    });
    const workspaceId = process.env.RAG_WORKSPACE_ID ?? "default";
    ragScheduler = createScheduler();
    ragScheduler.every(config.ragSyncIntervalMs, () =>
      ragIndex.syncAll({ workspaceId, git: gitAdapter }),
    );
    console.log(`[rag] scheduler started every ${config.ragSyncIntervalMs}ms`);
  }
}

// Callback route (always mounted; handler stubs out deps when ragDb absent)
const callbackHandler = createCallbackHandler({
  writeTechDesign: async ({ workspaceId, planeIssueId, content }) => {
    console.log(
      `[callback] writeTechDesign ws=${workspaceId} issue=${planeIssueId ?? "-"} len=${content.length}`,
    );
  },
  writeOpenApi: async ({ workspaceId, planeIssueId, content }) => {
    console.log(
      `[callback] writeOpenApi ws=${workspaceId} issue=${planeIssueId ?? "-"} len=${content.length}`,
    );
  },
  commentPlaneIssue: async ({ planeIssueId, content }) => {
    console.log(`[callback] commentPlaneIssue issue=${planeIssueId} len=${content.length}`);
  },
  loadDispatch: async (id) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id,
                workspace_id,
                skill,
                plane_issue_id,
                status,
                input_json,
                started_at,
                last_callback_at,
                timeout_at,
                error_message,
                result_summary,
                callback_replay_count,
                source_execution_id,
                source_stage
           FROM dispatch
          WHERE id=?`,
      )
      .get(id) as {
      id: string;
      workspace_id: string;
      skill: string;
      plane_issue_id: string | null;
      status: string;
      input_json: string;
      started_at: number | null;
      last_callback_at: number | null;
      timeout_at: number | null;
      error_message: string | null;
      result_summary: string | null;
      callback_replay_count: number;
      source_execution_id: number | null;
      source_stage: string | null;
    } | null;
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      skill: row.skill,
      planeIssueId: row.plane_issue_id ?? undefined,
      status: row.status as WorkflowDispatchStatus,
      input: JSON.parse(row.input_json),
      startedAt: row.started_at,
      lastCallbackAt: row.last_callback_at,
      timeoutAt: row.timeout_at,
      errorMessage: row.error_message,
      resultSummary: row.result_summary,
      callbackReplayCount: row.callback_replay_count,
      sourceExecutionId: row.source_execution_id,
      sourceStage: row.source_stage,
    };
  },
  claimDispatch: async (id) => {
    const { claimDispatchForCallback } = await import("./db/queries");
    return claimDispatchForCallback(getDb(), id);
  },
  releaseClaim: async (id) => {
    const { releaseDispatchClaim } = await import("./db/queries");
    return releaseDispatchClaim(getDb(), id);
  },
  markDone: async (id, status) => {
    const { updateDispatchStatus } = await import("./db/queries");
    return updateDispatchStatus(getDb(), id, status);
  },
  updateExecutionStatus: async (executionId, status, errorMessage) => {
    const { updateWorkflowStatus } = await import("./db/queries");
    updateWorkflowStatus(executionId, status, errorMessage);
  },
  triggerWorkflow,
});

app.route("/api/workflow/callback", callbackRoutes({ handler: callbackHandler, systemSecret }));
console.log("[callback] /api/workflow/callback mounted");

// 启动调度器（非测试环境）
if (process.env.NODE_ENV !== "test") {
  startScheduler();
}

// Graceful shutdown
process.on("SIGTERM", () => {
  ragScheduler?.stop();
  ragDb?.close();
  process.exit(0);
});

export default {
  port: config.port,
  fetch: app.fetch,
};
