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
const ragSync = await import("../services/rag-sync");

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
    expect(body.rag_sync_triggered).toBe(false);
  });

  it("POST /webhook/git triggers RAG sync on docs repo push", async () => {
    configOverrides = {
      difyDatasetApiKey: "test-key",
      difyDatasetId: "test-dataset",
    };
    const syncSpy = spyOn(ragSync, "syncRecentChanges").mockResolvedValue({
      created: 1,
      updated: 0,
      deleted: 0,
      skipped: 0,
      errors: [],
    });

    // Recreate routes to pick up new config overrides
    const freshApp = new Hono();
    freshApp.route("/webhook", createWebhookRoutes());

    const res = await freshApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: "org/docs", name: "docs" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rag_sync_triggered).toBe(true);
    expect(syncSpy).toHaveBeenCalledWith(10);
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

  it("POST /webhook/feishu triggers code_gen on approve action", async () => {
    const actionValue = JSON.stringify({
      action: "approve",
      issue_id: "ISS-50",
      doc_path: "tech-design/2026-04/login.md",
      workspace_id: 7,
    });

    await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { value: actionValue },
      }),
    });

    expect(triggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 7,
        workflow_type: "code_gen",
        trigger_source: "manual",
        plane_issue_id: "ISS-50",
        input_path: "tech-design/2026-04/login.md",
        target_repos: ["backend"],
      }),
    );
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
});

describe("feishu webhook - requirement callbacks", () => {
  let app: Hono;

  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    configOverrides = {};
    getDb();
    app = new Hono();
    app.route("/webhook", createWebhookRoutes());
    spyOn(workflowService, "triggerWorkflow").mockResolvedValue(1);
    spyOn(ibuildLogFetcher, "fetchBuildLogWithContext").mockResolvedValue("mocked build log");
  });

  afterEach(() => {
    closeDb();
    mock.restore();
    configOverrides = {};
  });

  async function seedDraftInReview() {
    const { createWorkspace, upsertUser, createRequirementDraft, updateRequirementDraft } =
      await import("../db/queries");
    const ws = createWorkspace({ name: "ReqWS", slug: `req-ws-${Date.now()}` });
    const user = upsertUser({ feishu_user_id: `req-user-${Date.now()}`, name: "PM" });
    const draft = createRequirementDraft({
      workspace_id: ws.id,
      creator_id: user.id,
      feishu_chat_id: "chat-req-test",
    });
    updateRequirementDraft(draft.id, {
      status: "review",
      issue_title: "用户登录",
      feishu_card_id: "msg-card-001",
    });
    return { draft, ws, user };
  }

  it("POST /webhook/feishu requirement_approve updates status to approved", async () => {
    const feishuService = await import("../services/feishu");
    spyOn(feishuService, "updateCard").mockResolvedValue();

    const { draft } = await seedDraftInReview();

    const actionValue = JSON.stringify({
      type: "requirement_approve",
      draft_id: draft.id,
    });

    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { value: actionValue } }),
    });
    expect(res.status).toBe(200);

    const { getRequirementDraft } = await import("../db/queries");
    const updated = getRequirementDraft(draft.id);
    expect(updated?.status).toBe("approved");
  });

  it("POST /webhook/feishu requirement_reject updates status to rejected", async () => {
    const feishuService = await import("../services/feishu");
    spyOn(feishuService, "updateCard").mockResolvedValue();

    const { draft } = await seedDraftInReview();

    const actionValue = JSON.stringify({
      type: "requirement_reject",
      draft_id: draft.id,
    });

    const res = await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { value: actionValue } }),
    });
    expect(res.status).toBe(200);

    const { getRequirementDraft } = await import("../db/queries");
    const updated = getRequirementDraft(draft.id);
    expect(updated?.status).toBe("rejected");
  });

  it("POST /webhook/feishu requirement_approve calls updateCard when feishu_card_id present", async () => {
    const feishuService = await import("../services/feishu");
    const updateCardSpy = spyOn(feishuService, "updateCard").mockResolvedValue();

    const { draft } = await seedDraftInReview();

    const actionValue = JSON.stringify({
      type: "requirement_approve",
      draft_id: draft.id,
    });

    await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { value: actionValue } }),
    });

    await Bun.sleep(0); // flush promise queue for async updateCard

    expect(updateCardSpy).toHaveBeenCalledWith(
      "msg-card-001",
      expect.objectContaining({
        header: expect.objectContaining({
          template: "green",
        }),
      }),
    );
  });

  it("POST /webhook/feishu requirement_reject calls updateCard when feishu_card_id present", async () => {
    const feishuService = await import("../services/feishu");
    const updateCardSpy = spyOn(feishuService, "updateCard").mockResolvedValue();

    const { draft } = await seedDraftInReview();

    const actionValue = JSON.stringify({
      type: "requirement_reject",
      draft_id: draft.id,
    });

    await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: { value: actionValue } }),
    });

    await Bun.sleep(0);

    expect(updateCardSpy).toHaveBeenCalledWith(
      "msg-card-001",
      expect.objectContaining({
        header: expect.objectContaining({
          template: "red",
        }),
      }),
    );
  });
});
