import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { closeDb, getDb } from "../db";
import * as workflowService from "../services/workflow";
import * as difyService from "../services/dify";

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
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(42);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "prd_to_tech",
        plane_issue_id: "ISSUE-1",
        params: { input_path: "/prd/test.md" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(42);
    expect(body.status).toBe("running");
    expect(body.message).toBe("工作流已触发");

    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "prd_to_tech",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-1",
      input_path: "/prd/test.md",
      target_repos: undefined,
    });
  });

  it("POST /api/workflow/trigger passes target_repos param", async () => {
    const triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(99);

    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_type: "code_gen",
        plane_issue_id: "ISSUE-5",
        params: { target_repos: ["backend", "web"] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution_id).toBe(99);

    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISSUE-5",
      input_path: undefined,
      target_repos: ["backend", "web"],
    });
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
    expect(spy).toHaveBeenCalledWith("What is ArcFlow?", undefined);
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
    expect(spy).toHaveBeenCalledWith("What stack?", "conv-002");
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
});
