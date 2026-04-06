import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { createWebhookRoutes } from "./webhook";
import { closeDb, getDb } from "../db";
import * as workflowService from "../services/workflow";
import * as ibuildLogFetcher from "../services/ibuild-log-fetcher";

describe("webhook routes", () => {
  let app: Hono;
  let triggerSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.PLANE_DEFAULT_PROJECT_ID = "test-plane-proj";
    getDb();
    app = new Hono();
    app.route("/webhook", createWebhookRoutes());
    triggerSpy = spyOn(workflowService, "triggerWorkflow").mockResolvedValue(1);
    spyOn(ibuildLogFetcher, "fetchBuildLogWithContext").mockResolvedValue("mocked build log");
  });

  afterEach(() => {
    closeDb();
    mock.restore();
    delete process.env.PLANE_DEFAULT_PROJECT_ID;
  });

  it("POST /webhook/plane returns received", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "issue_update" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("plane");
  });

  it("POST /webhook/plane triggers prd_to_tech when issue is Approved", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "issue",
        data: {
          id: "issue-42",
          state: { name: "Approved" },
          project: "proj-1",
          description_html: "prd/2026-04/login.md",
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "prd_to_tech",
      trigger_source: "plane_webhook",
      plane_issue_id: "issue-42",
      input_path: "prd/2026-04/login.md",
      project_id: "proj-1",
    });
  });

  it("POST /webhook/plane does not trigger workflow for non-Approved status", async () => {
    await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "issue",
        data: {
          id: "issue-43",
          state: { name: "In Progress" },
          project: "proj-1",
        },
      }),
    });
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("POST /webhook/git returns received", async () => {
    const res = await app.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
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
    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      plane_issue_id: "ISS-99",
      input_path: "Error: test assertion failed at line 42",
      project_id: "proj-2",
      target_repos: ["backend"],
    });
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
    });

    await app.request("/webhook/feishu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: { value: actionValue },
      }),
    });

    expect(triggerSpy).toHaveBeenCalledWith({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-50",
      input_path: "tech-design/2026-04/login.md",
      target_repos: ["backend"],
    });
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
