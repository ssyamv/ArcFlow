import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { closeDb, getDb } from "../db";
import * as workflowService from "../services/workflow";

describe("api routes", () => {
  let app: Hono;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    app = new Hono();
    app.route("/api", apiRoutes);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  it("POST /api/workflow/trigger calls triggerWorkflow", async () => {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "T", slug: "t-ws" });
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(42);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: ws.id,
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
        params: { input_path: "/prd/test.md" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(42);

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "prd_to_tech",
        trigger_source: "manual",
        plane_issue_id: "ISSUE-1",
        input_path: "/prd/test.md",
      }),
    );
  });

  it("POST /api/workflow/trigger returns 400 when workspace_id missing", async () => {
    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/workflow/trigger returns 404 when workspace not found", async () => {
    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: 99999,
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/workflow/trigger passes target_repos param", async () => {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "T2", slug: "t-ws-2" });
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(99);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-5",
        params: { target_repos: ["backend", "web"] },
      }),
    });
    expect(res.status).toBe(200);

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        trigger_source: "manual",
        plane_issue_id: "ISSUE-5",
        target_repos: ["backend", "web"],
      }),
    );
  });

  it("POST /api/workflow/trigger accepts legacy targets alias", async () => {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "T3", slug: "t-ws-3" });
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(77);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-6",
        params: { targets: ["backend"] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(77);

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        trigger_source: "manual",
        plane_issue_id: "ISSUE-6",
        target_repos: ["backend"],
      }),
    );
  });

  it("POST /api/workflow/trigger forwards optional source execution context", async () => {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "T4", slug: "t-ws-4" });
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(78);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-7",
        source_execution_id: 31,
        source_stage: "success",
        params: { target_repos: ["backend"] },
      }),
    });

    expect(res.status).toBe(200);
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-7",
        source_execution_id: 31,
        source_stage: "success",
      }),
    );
  });

  it("GET /api/workflow/executions returns list", async () => {
    // Seed data by calling triggerWorkflow directly (bypassing mock)
    const { createWorkflowExecution } = await import("../db/queries");
    createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-2",
    });

    const res = await app.request("/api/workflow/executions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/webhook/jobs returns filtered job diagnostics", async () => {
    const { claimWebhookJob, createWebhookJob, finishWebhookJob } = await import("../db/queries");
    const jobId = createWebhookJob({
      source: "git",
      event_type: "pull_request",
      action: "code_merge",
      payload: { branch: "feature/ISS-120-backend" },
    });
    claimWebhookJob(jobId);
    finishWebhookJob(jobId, {
      status: "failed",
      error: "code_gen_execution_not_found",
      retryDelayMs: 60_000,
    });

    const res = await app.request("/api/webhook/jobs?source=git&action=code_merge&status=pending");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      data: [
        expect.objectContaining({
          id: jobId,
          source: "git",
          event_type: "pull_request",
          action: "code_merge",
          status: "pending",
          attempt_count: 1,
          last_error: "code_gen_execution_not_found",
          payload: { branch: "feature/ISS-120-backend" },
          result: null,
        }),
      ],
      total: 1,
    });
  });

  it("GET /api/workflow/executions returns code_gen summary", async () => {
    const { createWorkflowExecution, createWorkflowSubtask } = await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-SUMMARY",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "ci_success",
      target: "backend",
      provider: "ibuild",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "ci_running",
      target: "web",
      provider: "ibuild",
      status: "running",
    });

    const res = await app.request("/api/workflow/executions");
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data[0]).toEqual(
      expect.objectContaining({
        workflow_type: "code_gen",
        summary: expect.objectContaining({
          total_targets: 2,
          completed_targets: 1,
          latest_stage: "ci_running",
        }),
      }),
    );
  });

  it("GET /api/workflow/executions summary counts only targets whose latest stage is ci_success", async () => {
    const { createWorkflowExecution, createWorkflowSubtask } = await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-SUMMARY-CONFLICT",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "ci_success",
      target: "backend",
      provider: "ibuild",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "ci_failed",
      target: "backend",
      provider: "ibuild",
      status: "failed",
    });

    const res = await app.request("/api/workflow/executions");
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data[0]).toEqual(
      expect.objectContaining({
        workflow_type: "code_gen",
        summary: expect.objectContaining({
          total_targets: 1,
          completed_targets: 0,
          latest_stage: "ci_failed",
        }),
      }),
    );
  });

  it("GET /api/workflow/executions/:id returns single execution", async () => {
    const { createWorkflowExecution } = await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "prd_to_tech",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-DETAIL",
    });

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.workflow_type).toBe("prd_to_tech");
    expect(body.plane_issue_id).toBe("ISSUE-DETAIL");
  });

  it("GET /api/workflow/executions/:id returns bug_report_summary for bug_analysis", async () => {
    const { createWorkflowExecution, createWorkflowSubtask } = await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      plane_issue_id: "ISS-BUG-1",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "analysis_ready",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
      output_ref: JSON.stringify({
        summary: "Type mismatch in webhook parser",
        root_cause: "branch_name is assumed to exist",
        suggested_fix: "Guard branch fallback lookup",
        confidence: "high",
        next_action: "auto_fix_candidate",
      }),
    });

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bug_report_summary).toEqual({
      summary: "Type mismatch in webhook parser",
      root_cause: "branch_name is assumed to exist",
      suggested_fix: "Guard branch fallback lookup",
      confidence: "high",
      next_action: "auto_fix_candidate",
    });
  });

  it("GET /api/workflow/executions/:id returns subtasks and links", async () => {
    const { createWorkflowExecution, createWorkflowSubtask, createWorkflowLink } =
      await import("../db/queries");
    const sourceId = createWorkflowExecution({
      workflow_type: "tech_to_openapi",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-SOURCE",
    });
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-DETAIL-EXTENDED",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "generate",
      target: "backend",
      provider: "nanoclaw",
      status: "success",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "ci_success",
      target: "backend",
      provider: "ibuild",
      status: "success",
    });
    const bugAnalysisId = createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      plane_issue_id: "ISSUE-BUG",
    });
    createWorkflowLink({
      source_execution_id: sourceId,
      target_execution_id: id,
      link_type: "derived_from",
      metadata: { source_stage: "success" },
    });
    createWorkflowLink({
      source_execution_id: id,
      target_execution_id: bugAnalysisId,
      link_type: "spawned_on_ci_failure",
      metadata: { external_run_id: "run-404" },
    });

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.subtasks).toHaveLength(2);
    expect(payload.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link_type: "derived_from" }),
        expect.objectContaining({ link_type: "spawned_on_ci_failure" }),
      ]),
    );
  });

  it("GET /api/workflow/executions/:id returns pre-callback dispatch summary for the real codegen flow", async () => {
    const { createWorkflowExecution, createWorkflowSubtask, insertDispatch } =
      await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-DISPATCH-DETAIL",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "dispatch",
      target: "backend",
      provider: "nanoclaw",
      status: "pending",
    });
    const dispatchId = insertDispatch(getDb(), {
      workspaceId: "ws-dispatch-detail",
      skill: "arcflow-prd-to-tech",
      input: { execution_id: id, target: "backend" },
      planeIssueId: "ISSUE-DISPATCH-DETAIL",
      sourceExecutionId: id,
      sourceStage: "dispatch",
      timeoutAt: 17_000,
    });

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_stage_summary).toEqual({
      label: "backend 等待 callback",
      stage: "dispatch_running",
      target: "backend",
      status: "pending",
    });
    expect(body.dispatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: dispatchId,
          status: "pending",
          source_execution_id: id,
          source_stage: "dispatch",
          diagnostic_flags: [],
        }),
      ]),
    );
  });

  it("GET /api/workflow/executions/:id prefers dispatch timeout diagnostics over stale running dispatch subtask", async () => {
    const { createWorkflowExecution, createWorkflowSubtask, insertDispatch, updateDispatchStatus } =
      await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-DISPATCH-TIMEOUT",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "dispatch",
      target: "backend",
      provider: "nanoclaw",
      status: "running",
    });
    const dispatchId = insertDispatch(getDb(), {
      workspaceId: "ws-dispatch-timeout",
      skill: "arcflow-prd-to-tech",
      input: { execution_id: id, target: "backend" },
      planeIssueId: "ISSUE-DISPATCH-TIMEOUT",
      sourceExecutionId: id,
      sourceStage: "dispatch",
      timeoutAt: 17_000,
    });
    updateDispatchStatus(getDb(), dispatchId, {
      status: "timeout",
      lastCallbackAt: 22_222,
      resultSummary: "late_callback_ignored",
      errorMessage: "callback timeout",
      replayIncrement: true,
    });

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_stage_summary).toEqual(
      expect.objectContaining({
        stage: "dispatch_timeout",
        target: "backend",
        status: "timeout",
      }),
    );
    expect(body.dispatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: dispatchId,
          status: "timeout",
          diagnostic_flags: expect.arrayContaining(["timed_out", "late_callback_ignored"]),
        }),
      ]),
    );
  });

  it("GET /api/workflow/executions/:id uses target-relevant dispatch diagnostics in multi-target executions", async () => {
    const { createWorkflowExecution, createWorkflowSubtask, insertDispatch, updateDispatchStatus } =
      await import("../db/queries");
    const id = createWorkflowExecution({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-DISPATCH-MULTI-TARGET",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "dispatch",
      target: "backend",
      provider: "nanoclaw",
      status: "running",
    });
    createWorkflowSubtask({
      execution_id: id,
      stage: "dispatch",
      target: "web",
      provider: "nanoclaw",
      status: "success",
    });

    const backendDispatchId = insertDispatch(getDb(), {
      workspaceId: "ws-dispatch-multi-target",
      skill: "arcflow-prd-to-tech",
      input: { execution_id: id, target: "backend" },
      planeIssueId: "ISSUE-DISPATCH-MULTI-TARGET",
      sourceExecutionId: id,
      sourceStage: "dispatch",
      timeoutAt: 17_000,
    });
    updateDispatchStatus(getDb(), backendDispatchId, {
      status: "timeout",
      lastCallbackAt: 22_222,
      resultSummary: "late_callback_ignored",
      errorMessage: "callback timeout",
      replayIncrement: true,
    });

    const webDispatchId = insertDispatch(getDb(), {
      workspaceId: "ws-dispatch-multi-target",
      skill: "arcflow-prd-to-tech",
      input: { execution_id: id, target: "web" },
      planeIssueId: "ISSUE-DISPATCH-MULTI-TARGET",
      sourceExecutionId: id,
      sourceStage: "dispatch",
      timeoutAt: 18_000,
    });
    getDb()
      .prepare("UPDATE dispatch SET status = 'running', started_at = 12_346 WHERE id = ?")
      .run(webDispatchId);

    const res = await app.request(`/api/workflow/executions/${id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.current_stage_summary).toEqual(
      expect.objectContaining({
        stage: "dispatch_timeout",
        target: "backend",
        status: "timeout",
      }),
    );
    expect(body.current_stage_summary.label).toContain("backend");
    expect(body.dispatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: backendDispatchId,
          status: "timeout",
          diagnostic_flags: expect.arrayContaining(["timed_out", "late_callback_ignored"]),
        }),
        expect.objectContaining({
          id: webDispatchId,
          status: "running",
        }),
      ]),
    );
  });

  it("GET /api/workflow/executions/:id returns 404 for non-existent", async () => {
    const res = await app.request("/api/workflow/executions/99999");
    expect(res.status).toBe(404);
  });

  it("GET /api/workflow/executions/:id returns 400 for invalid id", async () => {
    const res = await app.request("/api/workflow/executions/abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/workflow/executions filters by type", async () => {
    const { createWorkflowExecution } = await import("../db/queries");
    createWorkflowExecution({
      workflow_type: "bug_analysis",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-3",
    });

    const res = await app.request("/api/workflow/executions?workflow_type=bug_analysis");
    const body = await res.json();
    expect(
      body.data.every((e: { workflow_type: string }) => e.workflow_type === "bug_analysis"),
    ).toBe(true);
  });
});

describe("nanoclaw dispatch", () => {
  let app: Hono;
  let db: ReturnType<typeof getDb>;
  let dispatchUserId: number;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.NANOCLAW_DISPATCH_SECRET = "s";
    delete process.env.NANOCLAW_URL;
    db = getDb();
    app = new Hono();
    app.route("/api", apiRoutes);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
    delete process.env.NANOCLAW_DISPATCH_SECRET;
  });

  it("accepts arcflow-prd-to-tech with plane_issue_id and persists timeout_at", async () => {
    const { upsertUser } = await import("../db/queries");
    dispatchUserId = upsertUser({
      feishu_user_id: "dispatch-user",
      name: "Dispatch User",
    }).id;

    const res = await app.request("/api/nanoclaw/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", "X-System-Secret": "s" },
      body: JSON.stringify({
        skill: "arcflow-prd-to-tech",
        workspace_id: "w",
        user_id: dispatchUserId,
        plane_issue_id: "PROJ-1",
        input: { prd_path: "prd/x.md" },
      }),
    });
    expect(res.status).toBe(200);
    const { dispatch_id } = await res.json();
    const row = db
      .prepare("SELECT plane_issue_id, timeout_at FROM dispatch WHERE id=?")
      .get(dispatch_id) as { plane_issue_id: string; timeout_at: number } | null;
    expect(row?.plane_issue_id).toBe("PROJ-1");
    expect(row?.timeout_at).toBeGreaterThan(Date.now());
  });

  it("dispatches to NanoClaw WebChannel when NANOCLAW_URL is configured", async () => {
    const { upsertUser } = await import("../db/queries");
    dispatchUserId = upsertUser({
      feishu_user_id: "dispatch-user-http",
      name: "Dispatch User Http",
    }).id;
    process.env.NANOCLAW_URL = "http://nanoclaw.test/";
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await app.request("/api/nanoclaw/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", "X-System-Secret": "s" },
      body: JSON.stringify({
        skill: "arcflow-prd-to-tech",
        workspace_id: "w",
        user_id: dispatchUserId,
        plane_issue_id: "PROJ-2",
        input: { prd_path: "prd/y.md" },
      }),
    });

    globalThis.fetch = originalFetch;
    delete process.env.NANOCLAW_URL;

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://nanoclaw.test/api/chat");
  });

  it("rejects unknown skill", async () => {
    const res = await app.request("/api/nanoclaw/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", "X-System-Secret": "s" },
      body: JSON.stringify({ skill: "foo", workspace_id: "w" }),
    });
    expect(res.status).toBe(400);
  });
});
