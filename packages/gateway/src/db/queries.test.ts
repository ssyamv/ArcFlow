import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "./index";
import {
  createWorkflowExecution,
  getWorkflowExecution,
  updateWorkflowStatus,
  listWorkflowExecutions,
  recordWebhookEvent,
  isEventProcessed,
  cleanExpiredEvents,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
} from "./queries";

beforeEach(() => {
  process.env.NODE_ENV = "test";
  getDb();
});

afterEach(() => {
  closeDb();
});

describe("workflow_execution", () => {
  it("create and get workflow execution", () => {
    const id = createWorkflowExecution({
      workflow_type: "prd_to_tech",
      trigger_source: "plane_webhook",
      plane_issue_id: "ISSUE-1",
      input_path: "/docs/prd/test.md",
    });

    expect(id).toBeGreaterThan(0);

    const exec = getWorkflowExecution(id);
    expect(exec).not.toBeNull();
    expect(exec!.id).toBe(id);
    expect(exec!.workflow_type).toBe("prd_to_tech");
    expect(exec!.trigger_source).toBe("plane_webhook");
    expect(exec!.plane_issue_id).toBe("ISSUE-1");
    expect(exec!.input_path).toBe("/docs/prd/test.md");
    expect(exec!.status).toBe("pending");
    expect(exec!.retry_count).toBe(0);
  });

  it("update status from running to success sets completed_at", () => {
    const id = createWorkflowExecution({
      workflow_type: "tech_to_openapi",
      trigger_source: "manual",
    });

    updateWorkflowStatus(id, "running");
    const running = getWorkflowExecution(id);
    expect(running!.status).toBe("running");
    expect(running!.started_at).not.toBeNull();
    expect(running!.completed_at).toBeNull();

    updateWorkflowStatus(id, "success");
    const success = getWorkflowExecution(id);
    expect(success!.status).toBe("success");
    expect(success!.completed_at).not.toBeNull();
  });

  it("update status to failed with error message", () => {
    const id = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
    });

    updateWorkflowStatus(id, "failed", "Dify workflow error");
    const failed = getWorkflowExecution(id);
    expect(failed!.status).toBe("failed");
    expect(failed!.error_message).toBe("Dify workflow error");
    expect(failed!.completed_at).not.toBeNull();
  });

  it("list workflow executions with filters", () => {
    createWorkflowExecution({ workflow_type: "prd_to_tech", trigger_source: "manual" });
    createWorkflowExecution({ workflow_type: "prd_to_tech", trigger_source: "manual" });
    createWorkflowExecution({ workflow_type: "code_gen", trigger_source: "manual" });

    const allResult = listWorkflowExecutions({});
    expect(allResult.data.length).toBe(3);
    expect(allResult.total).toBe(3);

    const filteredResult = listWorkflowExecutions({ workflow_type: "prd_to_tech" });
    expect(filteredResult.data.length).toBe(2);
    expect(filteredResult.total).toBe(2);

    const limitedResult = listWorkflowExecutions({ limit: 2 });
    expect(limitedResult.data.length).toBe(2);
    expect(limitedResult.total).toBe(3);
  });

  it("list with status filter", () => {
    const id1 = createWorkflowExecution({ workflow_type: "prd_to_tech", trigger_source: "manual" });
    createWorkflowExecution({ workflow_type: "prd_to_tech", trigger_source: "manual" });

    updateWorkflowStatus(id1, "running");

    const runningResult = listWorkflowExecutions({ status: "running" });
    expect(runningResult.data.length).toBe(1);
    expect(runningResult.total).toBe(1);
  });

  it("get non-existent workflow execution returns null", () => {
    const exec = getWorkflowExecution(9999);
    expect(exec).toBeNull();
  });
});

describe("webhook_event", () => {
  it("record and check event processed", () => {
    recordWebhookEvent("evt-001", "plane");
    expect(isEventProcessed("evt-001")).toBe(true);
    expect(isEventProcessed("evt-999")).toBe(false);
  });

  it("duplicate insert does not throw", () => {
    recordWebhookEvent("evt-dup", "git");
    expect(() => recordWebhookEvent("evt-dup", "git")).not.toThrow();
    expect(isEventProcessed("evt-dup")).toBe(true);
  });

  it("clean expired events", () => {
    recordWebhookEvent("evt-new", "plane");
    recordWebhookEvent("evt-old", "cicd");

    // Backdate evt-old to 25 hours ago
    const db = getDb();
    db.exec(
      `UPDATE webhook_event SET received_at = datetime('now', '-25 hours') WHERE event_id = 'evt-old'`,
    );

    const deleted = cleanExpiredEvents();
    expect(deleted).toBe(1);
    expect(isEventProcessed("evt-new")).toBe(true);
    expect(isEventProcessed("evt-old")).toBe(false);
  });
});

describe("bug_fix_retry", () => {
  it("create and get bug fix retry", () => {
    createBugFixRetry("ISSUE-BUG-1");
    const retry = getBugFixRetry("ISSUE-BUG-1");
    expect(retry).not.toBeNull();
    expect(retry!.plane_issue_id).toBe("ISSUE-BUG-1");
    expect(retry!.retry_count).toBe(0);
    expect(retry!.status).toBe("pending");
    expect(retry!.last_attempt_at).toBeNull();
  });

  it("increment retry count", () => {
    createBugFixRetry("ISSUE-BUG-2");
    incrementBugFixRetry("ISSUE-BUG-2");

    const retry = getBugFixRetry("ISSUE-BUG-2");
    expect(retry!.retry_count).toBe(1);
    expect(retry!.status).toBe("fixing");
    expect(retry!.last_attempt_at).not.toBeNull();

    incrementBugFixRetry("ISSUE-BUG-2");
    const retry2 = getBugFixRetry("ISSUE-BUG-2");
    expect(retry2!.retry_count).toBe(2);
  });

  it("update bug fix status", () => {
    createBugFixRetry("ISSUE-BUG-3");
    updateBugFixStatus("ISSUE-BUG-3", "fixed");

    const retry = getBugFixRetry("ISSUE-BUG-3");
    expect(retry!.status).toBe("fixed");
  });

  it("create bug fix retry is idempotent (INSERT OR IGNORE)", () => {
    createBugFixRetry("ISSUE-BUG-4");
    expect(() => createBugFixRetry("ISSUE-BUG-4")).not.toThrow();

    const retry = getBugFixRetry("ISSUE-BUG-4");
    expect(retry!.retry_count).toBe(0);
  });

  it("get non-existent bug fix retry returns null", () => {
    const retry = getBugFixRetry("ISSUE-NONEXIST");
    expect(retry).toBeNull();
  });
});
