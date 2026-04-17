import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { getDb, closeDb } from "./index";
import {
  createWorkflowExecution,
  getWorkflowExecution,
  updateWorkflowStatus,
  listWorkflowExecutions,
  listWorkflowExecutionsWithSummary,
  createWorkflowSubtask,
  listWorkflowSubtasks,
  updateWorkflowSubtaskStatusByStage,
  findLatestCodegenExecution,
  createWorkflowLink,
  listWorkflowLinks,
  listWorkflowLinksBySourceExecution,
  getWorkflowExecutionDetail,
  recordWebhookEvent,
  isEventProcessed,
  cleanExpiredEvents,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
  recordWebhookLog,
  listWebhookLogs,
  insertDispatch,
  claimDispatchForCallback,
  releaseDispatchClaim,
  updateDispatchStatus,
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

  it("creates and lists workflow subtasks by execution", () => {
    const executionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-120",
    });

    createWorkflowSubtask({
      execution_id: executionId,
      stage: "dispatch",
      target: "backend",
      provider: "nanoclaw",
      status: "pending",
      input_ref: "input-1",
      output_ref: "output-1",
      external_run_id: "run-123",
      branch_name: "feature/issue-120",
      repo_name: "backend",
      log_url: "https://example.com/logs/123",
      error_message: "no error",
      started_at: "2026-04-16T08:00:00Z",
      finished_at: "2026-04-16T08:05:00Z",
    });

    const subtasks = listWorkflowSubtasks(executionId);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0]).toMatchObject({
      execution_id: executionId,
      stage: "dispatch",
      target: "backend",
      provider: "nanoclaw",
      status: "pending",
      input_ref: "input-1",
      output_ref: "output-1",
      external_run_id: "run-123",
      branch_name: "feature/issue-120",
      repo_name: "backend",
      log_url: "https://example.com/logs/123",
      error_message: "no error",
      started_at: "2026-04-16T08:00:00Z",
      finished_at: "2026-04-16T08:05:00Z",
    });
  });

  it("updates workflow subtasks by execution, target, and stage", () => {
    const executionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-121",
    });

    const subtaskId = updateWorkflowSubtaskStatusByStage({
      execution_id: executionId,
      stage: "ci_failed",
      target: "backend",
      provider: "generic",
      status: "failed",
      external_run_id: "run-1",
      log_url: "https://ci.example/run-1",
    });
    updateWorkflowSubtaskStatusByStage({
      execution_id: executionId,
      stage: "ci_failed",
      target: "backend",
      status: "failed",
      log_url: "https://ci.example/run-1?retry=1",
    });

    const ciFailed = listWorkflowSubtasks(executionId).filter(
      (subtask) => subtask.stage === "ci_failed",
    );
    expect(ciFailed).toHaveLength(1);
    expect(ciFailed[0]).toMatchObject({
      id: subtaskId,
      execution_id: executionId,
      stage: "ci_failed",
      target: "backend",
      provider: "generic",
      status: "failed",
      external_run_id: "run-1",
      log_url: "https://ci.example/run-1?retry=1",
    });
  });

  it("finds the latest code_gen execution by issue and target", () => {
    const olderExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-122",
    });
    createWorkflowSubtask({
      execution_id: olderExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });

    const newerExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-122",
    });
    createWorkflowSubtask({
      execution_id: newerExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: newerExecutionId,
      stage: "generate",
      target: "frontend",
      provider: "nanoclaw",
      status: "success",
    });

    const execution = findLatestCodegenExecution("ISSUE-122", "backend");
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(newerExecutionId);
  });

  it("prefers external run id over plain issue matching for code_gen execution lookup", () => {
    const olderExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-123",
    });
    createWorkflowSubtask({
      execution_id: olderExecutionId,
      stage: "ci_failed",
      target: "backend",
      provider: "generic",
      status: "failed",
      external_run_id: "run-123",
    });

    const newerExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-123",
    });
    createWorkflowSubtask({
      execution_id: newerExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });

    const execution = findLatestCodegenExecution("ISSUE-123", "backend", {
      externalRunId: "run-123",
    });
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(olderExecutionId);
  });

  it("scopes external run id matching by plane issue", () => {
    const collidingExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-OTHER",
    });
    createWorkflowSubtask({
      execution_id: collidingExecutionId,
      stage: "ci_failed",
      target: "backend",
      provider: "generic",
      status: "failed",
      external_run_id: "run-shared",
    });

    const intendedExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-125",
    });
    createWorkflowSubtask({
      execution_id: intendedExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });

    const execution = findLatestCodegenExecution("ISSUE-125", "backend", {
      externalRunId: "run-shared",
    });
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(intendedExecutionId);
  });

  it("prefers branch metadata over latest issue matching for code_gen execution lookup", () => {
    const olderExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-124",
    });
    createWorkflowSubtask({
      execution_id: olderExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      branch_name: "feature/ISSUE-124-a",
    });

    const newerExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-124",
    });
    createWorkflowSubtask({
      execution_id: newerExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      branch_name: "feature/ISSUE-124-b",
    });

    const execution = findLatestCodegenExecution("ISSUE-124", "backend", {
      branchName: "feature/ISSUE-124-a",
    });
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(olderExecutionId);
  });

  it("scopes branch matching by plane issue", () => {
    const collidingExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-OTHER-BRANCH",
    });
    createWorkflowSubtask({
      execution_id: collidingExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      branch_name: "feature/shared-branch",
    });

    const intendedExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-126",
    });
    createWorkflowSubtask({
      execution_id: intendedExecutionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });

    const execution = findLatestCodegenExecution("ISSUE-126", "backend", {
      branchName: "feature/shared-branch",
    });
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(intendedExecutionId);
  });

  it("finds code_gen execution by branch metadata when issue id is absent", () => {
    const executionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-127",
    });
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      branch_name: "feature/ISSUE-127-backend",
      repo_name: "backend",
    });

    const execution = findLatestCodegenExecution("", "backend", {
      branchName: "feature/ISSUE-127-backend",
    });
    expect(execution).not.toBeNull();
    expect(execution!.id).toBe(executionId);
  });

  it("creates workflow links between executions", () => {
    const sourceExecutionId = createWorkflowExecution({
      workflow_type: "tech_to_openapi",
      trigger_source: "manual",
    });
    const targetExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    createWorkflowLink({
      source_execution_id: sourceExecutionId,
      target_execution_id: targetExecutionId,
      link_type: "derived_from",
      metadata: { source_stage: "success" },
    });

    const links = listWorkflowLinks(targetExecutionId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source_execution_id: sourceExecutionId,
      target_execution_id: targetExecutionId,
      link_type: "derived_from",
    });
    expect(JSON.parse(links[0]!.metadata)).toEqual({ source_stage: "success" });
  });

  it("lists workflow links by source execution", () => {
    const sourceExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });
    const targetExecutionId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
    });

    createWorkflowLink({
      source_execution_id: sourceExecutionId,
      target_execution_id: targetExecutionId,
      link_type: "spawned_on_ci_failure",
      metadata: { external_run_id: "run-124" },
    });

    const links = listWorkflowLinksBySourceExecution(sourceExecutionId, "spawned_on_ci_failure");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      source_execution_id: sourceExecutionId,
      target_execution_id: targetExecutionId,
      link_type: "spawned_on_ci_failure",
    });
  });

  it("returns inbound and outbound workflow links in execution detail", () => {
    const parentExecutionId = createWorkflowExecution({
      workflow_type: "tech_to_openapi",
      trigger_source: "manual",
    });
    const codeGenExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });
    const bugExecutionId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
    });

    createWorkflowLink({
      source_execution_id: parentExecutionId,
      target_execution_id: codeGenExecutionId,
      link_type: "derived_from",
    });
    createWorkflowLink({
      source_execution_id: codeGenExecutionId,
      target_execution_id: bugExecutionId,
      link_type: "spawned_on_ci_failure",
    });

    const detail = getWorkflowExecutionDetail(codeGenExecutionId);
    expect(detail).not.toBeNull();
    expect(detail!.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link_type: "derived_from" }),
        expect.objectContaining({ link_type: "spawned_on_ci_failure" }),
      ]),
    );
  });

  it("builds code_gen summary from each target's latest stage", () => {
    const executionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    createWorkflowSubtask({
      execution_id: executionId,
      stage: "ci_success",
      target: "backend",
      provider: "ibuild",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "ci_failed",
      target: "backend",
      provider: "ibuild",
      status: "failed",
    });
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "ci_success",
      target: "web",
      provider: "ibuild",
      status: "success",
    });

    const result = listWorkflowExecutionsWithSummary({ workflow_type: "code_gen" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.summary).toEqual({
      total_targets: 2,
      completed_targets: 1,
      latest_stage: "ci_success",
    });
  });

  it("loads code_gen summaries without per-execution subtask lookups", () => {
    const firstExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });
    const secondExecutionId = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    createWorkflowSubtask({
      execution_id: firstExecutionId,
      stage: "ci_success",
      target: "backend",
      provider: "ibuild",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: secondExecutionId,
      stage: "ci_failed",
      target: "web",
      provider: "ibuild",
      status: "failed",
    });

    const db = getDb();
    const querySpy = spyOn(db, "query");

    const result = listWorkflowExecutionsWithSummary({ workflow_type: "code_gen" });

    expect(result.data).toHaveLength(2);
    const querySql = querySpy.mock.calls.map((call) => String(call[0]));
    expect(
      querySql.some(
        (sql) => sql.includes("FROM workflow_subtask") && sql.includes("WHERE execution_id = ?"),
      ),
    ).toBe(false);
    expect(
      querySql.some((sql) => sql.includes("FROM workflow_subtask") && sql.includes(" IN ")),
    ).toBe(true);
  });

  it("enforces foreign keys for workflow subtasks", () => {
    expect(() =>
      createWorkflowSubtask({
        execution_id: 999999,
        stage: "dispatch",
        target: "backend",
        provider: "nanoclaw",
      }),
    ).toThrow();
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

describe("dispatch", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("insertDispatch persists execution linkage and diagnostic fields", () => {
    const db = getDb();
    const executionId = createWorkflowExecution({
      workflow_type: "tech_to_openapi",
      trigger_source: "manual",
    });
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-tech-to-openapi",
      input: { execution_id: executionId },
      planeIssueId: "ISS-121",
      sourceExecutionId: executionId,
      sourceStage: "dispatch",
      timeoutAt: 9999,
    });
    const row = db
      .prepare(
        `SELECT status, plane_issue_id, source_execution_id, source_stage, started_at,
                last_callback_at, error_message, result_summary, callback_replay_count,
                timeout_at
           FROM dispatch WHERE id=?`,
      )
      .get(id) as {
      status: string;
      plane_issue_id: string;
      source_execution_id: number | null;
      source_stage: string | null;
      started_at: number | null;
      last_callback_at: number | null;
      error_message: string | null;
      result_summary: string | null;
      callback_replay_count: number;
      timeout_at: number;
    };
    expect(row.status).toBe("pending");
    expect(row.plane_issue_id).toBe("ISS-121");
    expect(row.source_execution_id).toBe(executionId);
    expect(row.source_stage).toBe("dispatch");
    expect(row.started_at).toBeNull();
    expect(row.last_callback_at).toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.result_summary).toBeNull();
    expect(row.callback_replay_count).toBe(0);
    expect(row.timeout_at).toBe(9999);
  });

  it("updateDispatchStatus marks success idempotently", () => {
    const db = getDb();
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-prd-to-tech",
      input: {},
    });
    const first = updateDispatchStatus(db, id, "success");
    const second = updateDispatchStatus(db, id, "success");
    expect(first).toBe(true);
    expect(second).toBe(false); // already completed returns false
  });

  it("updateDispatchStatus can finalize a timeout dispatch", () => {
    const db = getDb();
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-prd-to-tech",
      input: {},
    });
    db.prepare("UPDATE dispatch SET status = 'timeout' WHERE id = ?").run(id);

    const updated = updateDispatchStatus(db, id, "failed", "late callback ignored");

    expect(updated).toBe(true);
    const row = db
      .prepare("SELECT status, completed_at, error_message FROM dispatch WHERE id = ?")
      .get(id) as {
      status: string;
      completed_at: number | null;
      error_message: string | null;
    };
    expect(row.status).toBe("failed");
    expect(row.completed_at).not.toBeNull();
    expect(row.error_message).toBe("late callback ignored");
  });

  it("claimDispatchForCallback transitions pending dispatch to running once", () => {
    const db = getDb();
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-code-gen",
      input: {},
      timeoutAt: Date.now() + 1_000,
    });

    const first = claimDispatchForCallback(db, id, Date.now(), 5_000);
    const second = claimDispatchForCallback(db, id, Date.now(), 5_000);

    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = db.prepare("SELECT status FROM dispatch WHERE id = ?").get(id) as {
      status: string;
    };
    expect(row.status).toBe("running");
  });

  it("releaseDispatchClaim returns running dispatch to pending", () => {
    const db = getDb();
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-code-gen",
      input: {},
      timeoutAt: Date.now() + 1_000,
    });
    claimDispatchForCallback(db, id, Date.now(), 5_000);

    const released = releaseDispatchClaim(db, id);

    expect(released).toBe(true);
    const row = db.prepare("SELECT status, completed_at FROM dispatch WHERE id = ?").get(id) as {
      status: string;
      completed_at: number | null;
    };
    expect(row.status).toBe("pending");
    expect(row.completed_at).toBeNull();
  });

  it("claimDispatchForCallback can recover an expired running dispatch", () => {
    const db = getDb();
    const id = insertDispatch(db, {
      workspaceId: "w",
      skill: "arcflow-code-gen",
      input: {},
      timeoutAt: Date.now() + 1_000,
    });
    claimDispatchForCallback(db, id, Date.now(), 5_000);

    const reclaimed = claimDispatchForCallback(db, id, Date.now() + 10_000, 5_000);

    expect(reclaimed).toBe(true);
    const row = db.prepare("SELECT status, completed_at FROM dispatch WHERE id = ?").get(id) as {
      status: string;
      completed_at: number | null;
    };
    expect(row.status).toBe("running");
    expect(row.completed_at).toBeNull();
    const replayRow = db
      .prepare("SELECT callback_replay_count FROM dispatch WHERE id = ?")
      .get(id) as {
      callback_replay_count: number;
    };
    expect(replayRow.callback_replay_count).toBe(1);
  });
});
