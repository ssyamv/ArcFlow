import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { closeDb, getDb } from "../db";
import * as workflowService from "../services/workflow";
import * as difyService from "../services/dify";
import { recordWebhookLog } from "../db/queries";

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

describe("rag routes", () => {
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

  it("POST /api/rag/query returns answer", async () => {
    const spy = spyOn(difyService, "queryKnowledgeBase").mockResolvedValue({
      answer: "ArcFlow is an AI DevOps platform",
      conversation_id: "conv-001",
    });

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is ArcFlow?" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("ArcFlow is an AI DevOps platform");
    expect(body.conversation_id).toBe("conv-001");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("What is ArcFlow?", undefined, undefined);
  });

  it("POST /api/rag/query passes conversation_id", async () => {
    const spy = spyOn(difyService, "queryKnowledgeBase").mockResolvedValue({
      answer: "It uses Bun + Hono",
      conversation_id: "conv-002",
    });

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What stack?", conversation_id: "conv-002" }),
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("What stack?", "conv-002", undefined);
  });

  it("POST /api/rag/query returns 400 if question is empty", async () => {
    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("question is required");
  });

  it("POST /api/rag/query returns 500 on service error", async () => {
    spyOn(difyService, "queryKnowledgeBase").mockRejectedValue(new Error("Dify timeout"));

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Will this fail?" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("RAG query failed: Dify timeout");
  });

  it("GET /api/webhook/logs returns logs", async () => {
    recordWebhookLog("plane", { test: "payload" });

    const res = await app.request("/api/webhook/logs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].payload).toEqual({ test: "payload" });
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/webhook/logs filters by source", async () => {
    recordWebhookLog("git", { ref: "main" });

    const res = await app.request("/api/webhook/logs?source=git&limit=5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.every((l: { source: string }) => l.source === "git")).toBe(true);
  });

  it("POST /api/rag/query passes project_id", async () => {
    const spy = spyOn(difyService, "queryKnowledgeBase").mockResolvedValue({
      answer: "project-specific answer",
      conversation_id: "conv-p1",
    });

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What?", project_id: "proj-alpha" }),
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("What?", undefined, "proj-alpha");
  });
});

describe("POST /api/requirement/:id/approve", () => {
  let app: Hono;
  let authedUserId: number;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    getDb();

    const { upsertUser } = await import("../db/queries");
    const user = upsertUser({ feishu_user_id: `approve-api-user-${Date.now()}`, name: "PM" });
    authedUserId = user.id;

    app = new Hono();
    // Inject userId via middleware (bypasses JWT in tests)
    app.use("/*", async (c, next) => {
      c.set("userId" as never, authedUserId as never);
      await next();
    });
    app.route("/api", apiRoutes);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  it("returns 401 when not authenticated", async () => {
    const unauthApp = new Hono();
    unauthApp.route("/api", apiRoutes);
    const res = await unauthApp.request("/api/requirement/1/approve", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await app.request("/api/requirement/abc/approve", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("returns 200 and draft info on success", async () => {
    const requirementService = await import("../services/requirement");
    const {
      createWorkspace,
      addWorkspaceMember,
      createRequirementDraft,
      updateRequirementDraft,
      updateWorkspaceSettings,
    } = await import("../db/queries");
    const ws = createWorkspace({ name: "ApproveSuccWS", slug: `approve-succ-${Date.now()}` });
    updateWorkspaceSettings(ws.id, {
      plane_project_id: "proj-succ",
      plane_workspace_slug: "succ-slug",
    });
    addWorkspaceMember(ws.id, authedUserId);
    const draft = createRequirementDraft({ workspace_id: ws.id, creator_id: authedUserId });
    updateRequirementDraft(draft.id, { status: "review", issue_title: "成功审批" });
    updateRequirementDraft(draft.id, {
      plane_issue_id: "plane-123",
      prd_git_path: "prd/2026-04/test.md",
      status: "approved",
    });
    const approvedDraft = (await import("../db/queries")).getRequirementDraft(draft.id)!;

    spyOn(requirementService, "approveDraft").mockResolvedValue({
      ok: true,
      draft: approvedDraft,
    });

    const res = await app.request(`/api/requirement/${draft.id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plane_issue_id).toBe("plane-123");
    expect(body.prd_git_path).toBe("prd/2026-04/test.md");
    expect(body.draft.status).toBe("approved");
  });

  it("returns 400 when approveDraft returns state_check error", async () => {
    const requirementService = await import("../services/requirement");
    spyOn(requirementService, "approveDraft").mockResolvedValue({
      ok: false,
      error: '当前状态 "drafting" 不允许审批',
      step: "state_check",
    });

    const { createWorkspace, addWorkspaceMember, createRequirementDraft } =
      await import("../db/queries");
    const ws = createWorkspace({ name: "StateErrWS", slug: `state-err-${Date.now()}` });
    addWorkspaceMember(ws.id, authedUserId);
    const draft = createRequirementDraft({ workspace_id: ws.id, creator_id: authedUserId });

    const res = await app.request(`/api/requirement/${draft.id}/approve`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("drafting");
    expect(body.step).toBe("state_check");
  });

  it("returns 404 when draft not found", async () => {
    const requirementService = await import("../services/requirement");
    spyOn(requirementService, "approveDraft").mockResolvedValue({
      ok: false,
      error: "草稿不存在",
      step: "load",
    });

    const res = await app.request("/api/requirement/999999/approve", { method: "POST" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("不存在");
  });

  it("returns 403 when user has no permission", async () => {
    const requirementService = await import("../services/requirement");
    spyOn(requirementService, "approveDraft").mockResolvedValue({
      ok: false,
      error: "无权限审批此草稿",
      step: "auth",
    });

    const { createWorkspace, createRequirementDraft } = await import("../db/queries");
    const ws = createWorkspace({ name: "AuthErrWS", slug: `auth-err-${Date.now()}` });
    const draft = createRequirementDraft({ workspace_id: ws.id, creator_id: authedUserId });

    const res = await app.request(`/api/requirement/${draft.id}/approve`, { method: "POST" });
    expect(res.status).toBe(403);
  });
});
