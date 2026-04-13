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
  recordWebhookLog,
  listWebhookLogs,
  createRequirementDraft,
  getRequirementDraft,
  listRequirementDrafts,
  updateRequirementDraft,
  upsertUser,
  createWorkspace,
} from "./queries";

describe("workflow_execution", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

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

  it("update status to pending (else branch)", () => {
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    updateWorkflowStatus(id, "pending");
    const pending = getWorkflowExecution(id);
    expect(pending!.status).toBe("pending");
    expect(pending!.started_at).toBeNull();
    expect(pending!.completed_at).toBeNull();
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
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

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

describe("webhook_log", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("records and lists webhook logs", () => {
    recordWebhookLog("plane", { issue: "test-1" });
    recordWebhookLog("git", { ref: "main" });
    recordWebhookLog("plane", { issue: "test-2" });

    const all = listWebhookLogs(undefined, 10);
    expect(all.length).toBe(3);

    const planeOnly = listWebhookLogs("plane", 10);
    expect(planeOnly.length).toBe(2);
    expect(planeOnly.every((l) => l.source === "plane")).toBe(true);
  });
});

describe("bug_fix_retry", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

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

  it("stores bug_issue_id when provided", () => {
    createBugFixRetry("ISSUE-BUG-5", "BUG-100");
    const retry = getBugFixRetry("ISSUE-BUG-5");
    expect(retry!.bug_issue_id).toBe("BUG-100");
  });

  it("bug_issue_id defaults to null", () => {
    createBugFixRetry("ISSUE-BUG-6");
    const retry = getBugFixRetry("ISSUE-BUG-6");
    expect(retry!.bug_issue_id).toBeNull();
  });

  it("get non-existent bug fix retry returns null", () => {
    const retry = getBugFixRetry("ISSUE-NONEXIST");
    expect(retry).toBeNull();
  });
});

describe("requirement_drafts", () => {
  let workspaceId: number;
  let userId: number;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    const ws = createWorkspace({ name: "ReqWS", slug: `req-ws-${Date.now()}` });
    workspaceId = ws.id;
    const user = upsertUser({ feishu_user_id: `req-user-${Date.now()}`, name: "Req User" });
    userId = user.id;
  });

  afterEach(() => {
    closeDb();
  });

  it("creates a draft with defaults", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    expect(draft.id).toBeGreaterThan(0);
    expect(draft.workspace_id).toBe(workspaceId);
    expect(draft.creator_id).toBe(userId);
    expect(draft.status).toBe("drafting");
    expect(draft.issue_title).toBe("");
    expect(draft.issue_description).toBe("");
    expect(draft.prd_content).toBe("");
    expect(draft.prd_slug).toBeNull();
    expect(draft.dify_conversation_id).toBeNull();
    expect(draft.feishu_chat_id).toBeNull();
    expect(draft.approved_at).toBeNull();
    expect(draft.created_at).toBeTruthy();
    expect(draft.updated_at).toBeTruthy();
  });

  it("creates a draft with optional fields", () => {
    const draft = createRequirementDraft({
      workspace_id: workspaceId,
      creator_id: userId,
      feishu_chat_id: "chat-123",
      dify_conversation_id: "dify-conv-456",
    });
    expect(draft.feishu_chat_id).toBe("chat-123");
    expect(draft.dify_conversation_id).toBe("dify-conv-456");
  });

  it("gets draft by id", () => {
    const created = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    const fetched = getRequirementDraft(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
  });

  it("returns null for non-existent draft", () => {
    expect(getRequirementDraft(999999)).toBeNull();
  });

  it("lists drafts by workspace_id", () => {
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });

    const drafts = listRequirementDrafts({ workspace_id: workspaceId });
    expect(drafts.length).toBe(2);
  });

  it("lists drafts with status filter", () => {
    const d1 = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    updateRequirementDraft(d1.id, { status: "review" });

    const drafting = listRequirementDrafts({ workspace_id: workspaceId, status: "drafting" });
    expect(drafting.length).toBe(1);

    const review = listRequirementDrafts({ workspace_id: workspaceId, status: "review" });
    expect(review.length).toBe(1);
  });

  it("lists drafts with limit", () => {
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });

    const limited = listRequirementDrafts({ workspace_id: workspaceId, limit: 2 });
    expect(limited.length).toBe(2);
  });

  it("updates draft fields", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    const ok = updateRequirementDraft(draft.id, {
      issue_title: "新功能需求",
      issue_description: "详细描述",
      prd_content: "# PRD\n内容",
      prd_slug: "new-feature-req",
      dify_conversation_id: "conv-789",
    });
    expect(ok).toBe(true);

    const updated = getRequirementDraft(draft.id);
    expect(updated!.issue_title).toBe("新功能需求");
    expect(updated!.issue_description).toBe("详细描述");
    expect(updated!.prd_content).toBe("# PRD\n内容");
    expect(updated!.prd_slug).toBe("new-feature-req");
    expect(updated!.dify_conversation_id).toBe("conv-789");
  });

  it("updates status and sets approved_at when status is approved", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    updateRequirementDraft(draft.id, { status: "approved" });

    const updated = getRequirementDraft(draft.id);
    expect(updated!.status).toBe("approved");
    expect(updated!.approved_at).not.toBeNull();
  });

  it("does not set approved_at for non-approved status", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    updateRequirementDraft(draft.id, { status: "review" });

    const updated = getRequirementDraft(draft.id);
    expect(updated!.status).toBe("review");
    expect(updated!.approved_at).toBeNull();
  });

  it("returns false when updating non-existent draft", () => {
    const ok = updateRequirementDraft(999999, { issue_title: "x" });
    expect(ok).toBe(false);
  });

  it("returns false when patch is empty", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    const ok = updateRequirementDraft(draft.id, {});
    expect(ok).toBe(false);
  });

  it("filters drafts by creator_id", () => {
    const user2 = upsertUser({ feishu_user_id: `req-user2-${Date.now()}`, name: "User 2" });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    createRequirementDraft({ workspace_id: workspaceId, creator_id: user2.id });

    const mine = listRequirementDrafts({ creator_id: userId });
    expect(mine.length).toBe(1);
    expect(mine[0].creator_id).toBe(userId);
  });

  it("updates plane_issue_id and prd_git_path", () => {
    const draft = createRequirementDraft({ workspace_id: workspaceId, creator_id: userId });
    updateRequirementDraft(draft.id, {
      plane_issue_id: "PLANE-123",
      prd_git_path: "prd/2026-04/new-feature.md",
      feishu_card_id: "card-abc",
    });

    const updated = getRequirementDraft(draft.id);
    expect(updated!.plane_issue_id).toBe("PLANE-123");
    expect(updated!.prd_git_path).toBe("prd/2026-04/new-feature.md");
    expect(updated!.feishu_card_id).toBe("card-abc");
  });
});
