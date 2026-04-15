CREATE TABLE IF NOT EXISTS workflow_execution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  plane_issue_id TEXT,
  input_path TEXT,
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bug_fix_retry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plane_issue_id TEXT NOT NULL UNIQUE,
  bug_issue_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_event (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feishu_user_id TEXT NOT NULL UNIQUE,
  feishu_union_id TEXT,
  name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plane_project_id TEXT,
  plane_workspace_slug TEXT,
  wiki_path_prefix TEXT,
  git_repos TEXT NOT NULL DEFAULT '{}',
  feishu_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  workspace_id INTEGER REFERENCES workspaces(id),
  title TEXT NOT NULL DEFAULT '新对话',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- Batch 2-F: Agent memory snapshot support — persists notable user actions so
-- NanoClaw's memory_workspace_snapshot tool can surface "recent_user_actions".
CREATE TABLE IF NOT EXISTS user_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  workspace_id INTEGER REFERENCES workspaces(id),
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_action_log_user ON user_action_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_action_log_workspace ON user_action_log(workspace_id, created_at DESC);

-- NanoClaw dispatch 记账表：记录每次 skill 派发 + 回调状态
CREATE TABLE IF NOT EXISTS dispatch (
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
CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatch(status, created_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_plane_issue ON dispatch(plane_issue_id);

-- RAG 索引元数据
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
CREATE INDEX IF NOT EXISTS idx_rag_chunk_meta_doc
  ON rag_chunk_meta(workspace_id, doc_path);

-- 注：rag_chunks 是 sqlite-vec 虚表，只能运行时通过 vec0 创建，由 rag-index.ts 在初始化时执行
-- CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING vec0(...)

