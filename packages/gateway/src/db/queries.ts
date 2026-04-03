import { getDb } from "./index";
import type {
  WorkflowExecution,
  WorkflowType,
  WorkflowStatus,
  TriggerSource,
  BugFixRetry,
  BugFixStatus,
  WebhookSource,
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

// ─── bug_fix_retry ─────────────────────────────────────────────────────────────

export function createBugFixRetry(planeIssueId: string): void {
  const db = getDb();
  db.query(`INSERT OR IGNORE INTO bug_fix_retry (plane_issue_id) VALUES (?)`).run(planeIssueId);
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
