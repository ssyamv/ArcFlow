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

describe("nanoclaw dispatch", () => {
  let app: Hono;
  let db: ReturnType<typeof getDb>;

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
    const res = await app.request("/api/nanoclaw/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", "X-System-Secret": "s" },
      body: JSON.stringify({
        skill: "arcflow-prd-to-tech",
        workspace_id: "w",
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

  it("rejects unknown skill", async () => {
    const res = await app.request("/api/nanoclaw/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json", "X-System-Secret": "s" },
      body: JSON.stringify({ skill: "foo", workspace_id: "w" }),
    });
    expect(res.status).toBe(400);
  });
});
