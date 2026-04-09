import { getDb } from "./index";
import type {
  WorkflowExecution,
  WorkflowType,
  WorkflowStatus,
  TriggerSource,
  BugFixRetry,
  BugFixStatus,
  WebhookSource,
  User,
  Conversation,
  Message,
  Workspace,
} from "../types";

// ─── workflow_execution ────────────────────────────────────────────────────────

export function createWorkflowExecution(params: {
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
}): number {
  const db = getDb();
  db.query(
    `INSERT INTO workflow_execution (workflow_type, trigger_source, plane_issue_id, input_path)
     VALUES (?, ?, ?, ?)`,
  ).run(
    params.workflow_type,
    params.trigger_source,
    params.plane_issue_id ?? null,
    params.input_path ?? null,
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return row.id;
}

export function getWorkflowExecution(id: number): WorkflowExecution | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM workflow_execution WHERE id = ?")
    .get(id) as WorkflowExecution | null;
  return row ?? null;
}

export function listWorkflowExecutions(filters: {
  workflow_type?: WorkflowType;
  status?: WorkflowStatus;
  limit?: number;
}): { data: WorkflowExecution[]; total: number } {
  const db = getDb();
  const limit = filters.limit ?? 20;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (filters.workflow_type) {
    conditions.push("workflow_type = ?");
    values.push(filters.workflow_type);
  }
  if (filters.status) {
    conditions.push("status = ?");
    values.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM workflow_execution ${where}`)
    .get(...values) as { count: number };
  const total = countRow.count;

  const data = db
    .query(`SELECT * FROM workflow_execution ${where} ORDER BY id DESC LIMIT ?`)
    .all(...values, limit) as WorkflowExecution[];

  return { data, total };
}

export function updateWorkflowStatus(
  id: number,
  status: WorkflowStatus,
  errorMessage?: string,
): void {
  const db = getDb();

  const setCompleted = status === "success" || status === "failed";
  const setStarted = status === "running";

  if (setStarted) {
    db.query(
      `UPDATE workflow_execution
       SET status = ?, started_at = datetime('now'), error_message = ?
       WHERE id = ?`,
    ).run(status, errorMessage ?? null, id);
  } else if (setCompleted) {
    db.query(
      `UPDATE workflow_execution
       SET status = ?, completed_at = datetime('now'), error_message = ?
       WHERE id = ?`,
    ).run(status, errorMessage ?? null, id);
  } else {
    db.query(`UPDATE workflow_execution SET status = ?, error_message = ? WHERE id = ?`).run(
      status,
      errorMessage ?? null,
      id,
    );
  }
}

// ─── webhook_event ─────────────────────────────────────────────────────────────

export function recordWebhookEvent(eventId: string, source: WebhookSource): void {
  const db = getDb();
  db.query(`INSERT OR IGNORE INTO webhook_event (event_id, source) VALUES (?, ?)`).run(
    eventId,
    source,
  );
}

export function isEventProcessed(eventId: string): boolean {
  const db = getDb();
  const row = db.query("SELECT 1 as found FROM webhook_event WHERE event_id = ?").get(eventId) as {
    found: number;
  } | null;
  return row !== null;
}

export function cleanExpiredEvents(): number {
  const db = getDb();
  db.query(`DELETE FROM webhook_event WHERE received_at < datetime('now', '-24 hours')`).run();
  const row = db.query("SELECT changes() as n").get() as { n: number };
  return row.n;
}

// ─── webhook_log ──────────────────────────────────────────────────────────────

export function recordWebhookLog(source: WebhookSource, payload: unknown): void {
  const db = getDb();
  db.query(`INSERT INTO webhook_log (source, payload) VALUES (?, ?)`).run(
    source,
    JSON.stringify(payload),
  );
}

export interface WebhookLogEntry {
  id: number;
  source: string;
  payload: string;
  created_at: string;
}

export function listWebhookLogs(source?: WebhookSource, limit = 50): WebhookLogEntry[] {
  const db = getDb();
  if (source) {
    return db
      .query("SELECT * FROM webhook_log WHERE source = ? ORDER BY id DESC LIMIT ?")
      .all(source, limit) as WebhookLogEntry[];
  }
  return db
    .query("SELECT * FROM webhook_log ORDER BY id DESC LIMIT ?")
    .all(limit) as WebhookLogEntry[];
}

// ─── bug_fix_retry ─────────────────────────────────────────────────────────────

export function createBugFixRetry(planeIssueId: string, bugIssueId?: string): void {
  const db = getDb();
  db.query(`INSERT OR IGNORE INTO bug_fix_retry (plane_issue_id, bug_issue_id) VALUES (?, ?)`).run(
    planeIssueId,
    bugIssueId ?? null,
  );
}

export function getBugFixRetry(planeIssueId: string): BugFixRetry | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM bug_fix_retry WHERE plane_issue_id = ?")
    .get(planeIssueId) as BugFixRetry | null;
  return row ?? null;
}

export function incrementBugFixRetry(planeIssueId: string): void {
  const db = getDb();
  db.query(
    `UPDATE bug_fix_retry
     SET retry_count = retry_count + 1, last_attempt_at = datetime('now'), status = 'fixing'
     WHERE plane_issue_id = ?`,
  ).run(planeIssueId);
}

export function updateBugFixStatus(planeIssueId: string, status: BugFixStatus): void {
  const db = getDb();
  db.query(`UPDATE bug_fix_retry SET status = ? WHERE plane_issue_id = ?`).run(
    status,
    planeIssueId,
  );
}

// ─── users ────────────────────────────────────────────────────────────────────

export function findUserByFeishuId(feishuUserId: string): User | null {
  const db = getDb();
  return db.query("SELECT * FROM users WHERE feishu_user_id = ?").get(feishuUserId) as User | null;
}

export function upsertUser(params: {
  feishu_user_id: string;
  feishu_union_id?: string;
  name: string;
  avatar_url?: string;
  email?: string;
}): User {
  const db = getDb();
  const existing = findUserByFeishuId(params.feishu_user_id);
  if (existing) {
    db.query(
      `UPDATE users SET name = ?, avatar_url = ?, email = ?, feishu_union_id = ?, last_login_at = datetime('now') WHERE id = ?`,
    ).run(
      params.name,
      params.avatar_url ?? null,
      params.email ?? null,
      params.feishu_union_id ?? null,
      existing.id,
    );
    return findUserByFeishuId(params.feishu_user_id)!;
  }
  db.query(
    `INSERT INTO users (feishu_user_id, feishu_union_id, name, avatar_url, email, last_login_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    params.feishu_user_id,
    params.feishu_union_id ?? null,
    params.name,
    params.avatar_url ?? null,
    params.email ?? null,
  );
  return findUserByFeishuId(params.feishu_user_id)!;
}

export function getUserById(id: number): User | null {
  const db = getDb();
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}

// ─── workspaces ──────────────────────────────────────────────────────────────

export function listUserWorkspaces(userId: number): Workspace[] {
  const db = getDb();
  return db
    .query(
      `SELECT w.* FROM workspaces w
     INNER JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = ?
     ORDER BY w.name ASC`,
    )
    .all(userId) as Workspace[];
}

export function getWorkspace(id: number): Workspace | null {
  const db = getDb();
  return db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as Workspace | null;
}

export function getWorkspaceBySlug(slug: string): Workspace | null {
  const db = getDb();
  return db.query("SELECT * FROM workspaces WHERE slug = ?").get(slug) as Workspace | null;
}

export function getWorkspaceByPlaneProject(planeProjectId: string): Workspace | null {
  const db = getDb();
  return db
    .query("SELECT * FROM workspaces WHERE plane_project_id = ?")
    .get(planeProjectId) as Workspace | null;
}

export function createWorkspace(params: {
  name: string;
  slug: string;
  plane_project_id?: string;
}): Workspace {
  const db = getDb();
  db.query("INSERT OR IGNORE INTO workspaces (name, slug, plane_project_id) VALUES (?, ?, ?)").run(
    params.name,
    params.slug,
    params.plane_project_id ?? null,
  );
  return getWorkspaceBySlug(params.slug)!;
}

export function updateWorkspaceSettings(
  id: number,
  patch: {
    dify_dataset_id?: string;
    dify_rag_api_key?: string;
    wiki_path_prefix?: string;
    git_repos?: string;
  },
): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.dify_dataset_id !== undefined) {
    sets.push("dify_dataset_id = ?");
    values.push(patch.dify_dataset_id);
  }
  if (patch.dify_rag_api_key !== undefined) {
    sets.push("dify_rag_api_key = ?");
    values.push(patch.dify_rag_api_key);
  }
  if (patch.wiki_path_prefix !== undefined) {
    sets.push("wiki_path_prefix = ?");
    values.push(patch.wiki_path_prefix);
  }
  if (patch.git_repos !== undefined) {
    sets.push("git_repos = ?");
    values.push(patch.git_repos);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  const result = db.query(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function addWorkspaceMember(
  workspaceId: number,
  userId: number,
  role: "admin" | "member" = "member",
): void {
  const db = getDb();
  db.query(
    "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)",
  ).run(workspaceId, userId, role);
}

export function getWorkspaceMemberRole(workspaceId: number, userId: number): string | null {
  const db = getDb();
  const row = db
    .query("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { role: string } | null;
  return row?.role ?? null;
}

export function listWorkspaceMembers(
  workspaceId: number,
): Array<{ user_id: number; name: string; role: string }> {
  const db = getDb();
  return db
    .query(
      `SELECT wm.user_id, u.name, wm.role FROM workspace_members wm
     INNER JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ?
     ORDER BY wm.role ASC, u.name ASC`,
    )
    .all(workspaceId) as Array<{ user_id: number; name: string; role: string }>;
}

// ─── conversations ───────────────────────────────────────────────────────────

export function listConversations(userId: number, workspaceId?: number | null): Conversation[] {
  const db = getDb();
  if (workspaceId) {
    return db
      .query(
        "SELECT * FROM conversations WHERE user_id = ? AND workspace_id = ? ORDER BY pinned DESC, updated_at DESC",
      )
      .all(userId, workspaceId) as Conversation[];
  }
  return db
    .query("SELECT * FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC")
    .all(userId) as Conversation[];
}

export function getConversation(id: number, userId: number): Conversation | null {
  const db = getDb();
  return db
    .query("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
    .get(id, userId) as Conversation | null;
}

export function createConversation(
  userId: number,
  title?: string,
  workspaceId?: number | null,
): Conversation {
  const db = getDb();
  db.query("INSERT INTO conversations (user_id, workspace_id, title) VALUES (?, ?, ?)").run(
    userId,
    workspaceId ?? null,
    title ?? "新对话",
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return db.query("SELECT * FROM conversations WHERE id = ?").get(row.id) as Conversation;
}

export function updateConversation(
  id: number,
  userId: number,
  patch: { title?: string; pinned?: number },
): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title);
  }
  if (patch.pinned !== undefined) {
    sets.push("pinned = ?");
    values.push(patch.pinned);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = datetime('now')");
  values.push(id, userId);
  const result = db
    .query(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...values);
  return result.changes > 0;
}

export function deleteConversation(id: number, userId: number): boolean {
  const db = getDb();
  const result = db.query("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

export function searchConversations(userId: number, query: string): Conversation[] {
  const db = getDb();
  const like = `%${query}%`;
  return db
    .query(
      `SELECT DISTINCT c.* FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.user_id = ? AND (c.title LIKE ? OR m.content LIKE ?)
     ORDER BY c.updated_at DESC`,
    )
    .all(userId, like, like) as Conversation[];
}

// ─── messages ────────────────────────────────────────────────────────────────

export function listMessages(conversationId: number, limit = 100): Message[] {
  const db = getDb();
  return db
    .query("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?")
    .all(conversationId, limit) as Message[];
}

export function createMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Message {
  const db = getDb();
  db.query("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)").run(
    conversationId,
    role,
    content,
  );
  db.query("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(
    conversationId,
  );
  const row = db.query("SELECT last_insert_rowid() as id").get() as { id: number };
  return db.query("SELECT * FROM messages WHERE id = ?").get(row.id) as Message;
}
