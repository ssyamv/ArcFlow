import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { closeDb, getDb } from "../db";
import { createTestConfig } from "../test-config";

// Mock config to ensure stable values regardless of other test files' mock.module pollution
let configOverrides: Record<string, unknown> = {};
mock.module("../config", () => ({
  getConfig: () => createTestConfig(configOverrides),
}));

const { createWebhookRoutes } = await import("./webhook");
const workflowService = await import("../services/workflow");
const ibuildLogFetcher = await import("../services/ibuild-log-fetcher");

describe("webhook routes", () => {
  let app: Hono;
  let triggerSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    configOverrides = {};
    getDb();
    app = new Hono();
    app.route("/webhook", createWebhookRoutes());
    triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(1);
    spyOn(ibuildLogFetcher, "fetchBuildLogWithContext").mockResolvedValue("mocked build log");
  });

  afterEach(() => {
    closeDb();
    mock.restore();
    configOverrides = {};
  });

  it("POST /webhook/plane returns received", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "project",
        action: "update",
        webhook_id: "wh-1",
        workspace_id: "ws-1",
        data: { id: "proj-1" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("plane");
  });

  it("POST /webhook/plane triggers prd_to_tech when issue state matches approved", async () => {
    const { createWorkspace, updateWorkspaceSettings } = await import("../db/queries");
    const ws = createWorkspace({ name: "WS", slug: "ws-plane-1", plane_project_id: "proj-1" });
    updateWorkspaceSettings(ws.id, { feishu_chat_id: "oc_ws_chat" });

    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "issue",
        action: "update",
        webhook_id: "wh-1",
        workspace_id: "ws-1",
        data: {
          id: "issue-42",
          state_id: "state-approved",
          project_id: "proj-1",
          description_text: "需求文档 prd/2026-04/login.md 请审阅",
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "prd_to_tech",
        trigger_source: "plane_webhook",
        plane_issue_id: "issue-42",
        input_path: "prd/2026-04/login.md",
        chat_id: "oc_ws_chat",
      }),
    );
  });

  it("POST /webhook/plane does not trigger workflow for non-Approved state", async () => {
    await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "issue",
        action: "update",
        webhook_id: "wh-1",
        workspace_id: "ws-1",
        data: {
          id: "issue-43",
          state_id: "state-in-progress",
          project_id: "proj-1",
        },
      }),
    });
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/git returns received", async () => {
    const res = await app.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main", repository: { name: "backend" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("git");
  });

  it("POST /webhook/cicd returns received", async () => {
    const res = await app.request("/webhook/cicd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("cicd");
  });

  it("POST /webhook/cicd triggers bug_analysis on failure", async () => {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "CI", slug: "ci-ws", plane_project_id: "proj-2" });

    const res = await app.request("/webhook/cicd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "failed",
        logs: "Error: test assertion failed at line 42",
        issue_id: "ISS-99",
        project_id: "proj-2",
        repository: "backend",
      }),
    });
    expect(res.status).toBe(200);
    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: ws.id,
        workflow_type: "bug_analysis",
        trigger_source: "cicd_webhook",
        plane_issue_id: "ISS-99",
        input_path: "Error: test assertion failed at line 42",
        target_repos: ["backend"],
      }),
    );
  });

  it("POST /webhook/cicd does not trigger on success status", async () => {
    await app.request("/webhook/cicd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success" }),
    });
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/feishu returns received", async () => {
    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("feishu");
  });

  it("POST /webhook/feishu ignores legacy card action callbacks (Batch 4-I)", async () => {
    // Card reverse callbacks are no longer supported — cards now use Web
    // redirect links carrying approval tokens. The endpoint stays only to
    // answer Feishu's URL verification challenge.
    const actionValue = JSON.stringify({
      action: "approve",
      issue_id: "ISS-50",
      doc_path: "tech-design/2026-04/login.md",
      workspace_id: 7,
    });

    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { value: actionValue } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handled).toBe(false);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/feishu does not trigger on reject action", async () => {
    const actionValue = JSON.stringify({
      action: "reject",
      issue_id: "ISS-51",
    });

    await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { value: actionValue },
      }),
    });

    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/feishu handles invalid action value gracefully", async () => {
    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { value: "not-json{{{" },
      }),
    });
    expect(res.status).toBe(200);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  // iBuild tests
  async function seedIbuildWorkspace() {
    const { createWorkspace } = await import("../db/queries");
    const ws = createWorkspace({ name: "iBuild WS", slug: "ibuild-ws", plane_project_id: "p-ib" });
    configOverrides = { ibuildAppWorkspaceMap: { DZHCS: "ibuild-ws" } };
    // re-build app with new config
    app = new Hono();
    app.route("/webhook", createWebhookRoutes());
    return ws;
  }

  function ibuildPayload(overrides: Record<string, string> = {}): string {
    const defaults: Record<string, string> = {
      status: "FAIL",
      buildId: "1661",
      projectId: "proj-ibuild-1",
      appId: "app-ibuild-1",
      gitBranch: "feat/PROJ-123-add-login",
      commitId: "b2140960",
      projectKey: "TESTPROJ",
      appKey: "DZHCS",
      builder: "testuser",
      startTime: "2026-04-06 10:00:00",
    };
    const params = { ...defaults, ...overrides };
    return new URLSearchParams(params).toString();
  }

  it("POST /webhook/ibuild returns received with triggered=true on FAIL", async () => {
    await seedIbuildWorkspace();
    const res = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
  });

  it("POST /webhook/ibuild does not trigger on SUCCEED status", async () => {
    const res = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({ status: "SUCCEED", buildId: "1662" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/ibuild does not trigger on PROCESSING status", async () => {
    const res = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({ status: "PROCESSING", buildId: "1663" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
  });

  it("POST /webhook/ibuild does not trigger on CANCEL status", async () => {
    const res = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({ status: "CANCEL", buildId: "1664" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
  });

  it("POST /webhook/ibuild triggers on ABORT status", async () => {
    await seedIbuildWorkspace();
    const res = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({ status: "ABORT", buildId: "1665" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
  });

  it("POST /webhook/ibuild rejects invalid secret", async () => {
    const res = await app.request("/webhook/ibuild?secret=wrong", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload(),
    });
    expect(res.status).toBe(401);
  });

  it("POST /webhook/ibuild deduplicates by buildId", async () => {
    const payload = ibuildPayload({ buildId: "1666" });
    await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });
    const res2 = await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    });
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.message).toBe("Event already processed");
  });

  it("POST /webhook/ibuild extracts issue ID from branch and maps repo", async () => {
    await seedIbuildWorkspace();
    await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({
        gitBranch: "feat/PROJ-123-add-login",
        buildId: "1667",
        appKey: "DZHCS",
      }),
    });

    await Bun.sleep(0); // flush microtask queue for async log fetch

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_type: "bug_analysis",
        trigger_source: "ibuild_webhook",
        plane_issue_id: "PROJ-123",
        input_path: "mocked build log",
      }),
    );
  });

  it("POST /webhook/ibuild handles unrecognized branch gracefully", async () => {
    await seedIbuildWorkspace();
    await app.request("/webhook/ibuild?secret=", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ibuildPayload({ gitBranch: "master", buildId: "1668" }),
    });

    await Bun.sleep(0); // flush microtask queue for async log fetch

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        plane_issue_id: undefined,
        trigger_source: "ibuild_webhook",
      }),
    );
  });

  it("POST /webhook/plane approved → dispatch table has arcflow-prd-to-tech row", async () => {
    const { createWorkspace, updateWorkspaceSettings } = await import("../db/queries");
    const ws = createWorkspace({ name: "WS2", slug: "ws-dispatch-1", plane_project_id: "proj-d" });
    updateWorkspaceSettings(ws.id, {});

    await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "issue",
        action: "update",
        webhook_id: "wh-d",
        workspace_id: "ws-1",
        data: {
          id: "issue-99",
          state_id: "state-approved",
          project_id: "proj-d",
          description_text: "需求文档 prd/2026-04/feature.md",
        },
      }),
    });

    const db = getDb();
    const row = db
      .prepare("SELECT skill, plane_issue_id FROM dispatch WHERE plane_issue_id=?")
      .get("issue-99") as { skill: string; plane_issue_id: string } | null;
    expect(row?.skill).toBe("arcflow-prd-to-tech");
    expect(row?.plane_issue_id).toBe("issue-99");
  });
});
