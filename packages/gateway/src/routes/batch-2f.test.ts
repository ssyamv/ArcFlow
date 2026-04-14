import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { closeDb, getDb } from "../db";
import { workspaceRoutes } from "./workspaces";
import { approvalRoutes } from "./approval";
import { apiRoutes } from "./api";
import { signJwt } from "../services/auth";
import {
  signApprovalToken,
  verifyApprovalToken,
  consumeApprovalToken,
} from "../services/approval-token";
import {
  upsertUser,
  createWorkspace,
  addWorkspaceMember,
  updateRequirementDraft,
  recordUserAction,
  isApprovalTokenConsumed,
  buildMemorySnapshot,
  createWorkflowExecution,
} from "../db/queries";
import { createDraft } from "../services/requirement";

describe("Batch 2-F: workspaces/:id/members/me", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const u = upsertUser({ feishu_user_id: "ou_b2f_ws", name: "b2f-ws" });
    userId = u.id;
    token = await signJwt({ sub: u.id, role: "member" });
  });
  afterEach(() => closeDb());

  it("returns role + slug for a member", async () => {
    const ws = createWorkspace({ name: "W", slug: "w-ms" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await workspaceRoutes.request(`/${ws.id}/members/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user_id: userId,
      workspace_id: ws.id,
      role: "admin",
      workspace_slug: "w-ms",
    });
  });

  it("returns 403 for non-member", async () => {
    const ws = createWorkspace({ name: "W2", slug: "w-nm" });
    const res = await workspaceRoutes.request(`/${ws.id}/members/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without Bearer token", async () => {
    const res = await workspaceRoutes.request(`/1/members/me`);
    expect(res.status).toBe(401);
  });
});

describe("Batch 2-F: approval tokens", () => {
  let userId: number;
  let userToken: string;
  let draftId: number;
  let wsId: number;

  beforeEach(async () => {
    getDb();
    const u = upsertUser({ feishu_user_id: "ou_b2f_appr", name: "b2f-appr" });
    userId = u.id;
    userToken = await signJwt({ sub: u.id, role: "admin" });
    const ws = createWorkspace({ name: "AP", slug: "ap-ws" });
    wsId = ws.id;
    addWorkspaceMember(ws.id, userId, "admin");
    draftId = createDraft({ workspaceId: ws.id, creatorId: userId }).id;
    updateRequirementDraft(draftId, { status: "review" });
  });
  afterEach(() => closeDb());

  it("signs + verifies + consumes (one-shot)", async () => {
    const tok = await signApprovalToken({
      userId,
      action: "approve",
      resourceType: "requirement_draft",
      resourceId: String(draftId),
    });

    const first = await verifyApprovalToken(tok);
    if (!first.ok) throw new Error("expected verify ok");
    expect(first.payload.action).toBe("approve");

    const consumed = consumeApprovalToken(first.payload);
    expect(consumed).toBe(true);
    expect(isApprovalTokenConsumed(first.payload.jti)).toBe(true);

    const second = consumeApprovalToken(first.payload);
    expect(second).toBe(false);

    const reverify = await verifyApprovalToken(tok);
    expect(reverify.ok).toBe(false);
    if (!reverify.ok) expect(reverify.code).toBe("already_consumed");
  });

  it("POST /verify rejects bad token", async () => {
    const res = await approvalRoutes.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not.a.jwt" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /verify accepts valid token without consuming", async () => {
    const tok = await signApprovalToken({
      userId,
      action: "approve",
      resourceType: "requirement_draft",
      resourceId: String(draftId),
    });
    const res = await approvalRoutes.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tok }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.payload.action).toBe("approve");

    // Not yet consumed.
    const again = await verifyApprovalToken(tok);
    expect(again.ok).toBe(true);
  });

  it("POST /execute applies approve and marks consumed", async () => {
    const tok = await signApprovalToken({
      userId,
      action: "approve",
      resourceType: "requirement_draft",
      resourceId: String(draftId),
    });
    const res = await approvalRoutes.request("/execute", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tok, note: "looks good" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("approve");

    // Draft now approved.
    const row = getDb()
      .query("SELECT status FROM requirement_drafts WHERE id = ?")
      .get(draftId) as { status: string };
    expect(row.status).toBe("approved");

    // Second attempt returns 410 already_consumed.
    const res2 = await approvalRoutes.request("/execute", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tok }),
    });
    expect(res2.status).toBe(410);
  });

  it("POST /execute refuses when caller != token user", async () => {
    const other = upsertUser({ feishu_user_id: "ou_b2f_other", name: "other" });
    const otherToken = await signJwt({ sub: other.id, role: "member" });
    addWorkspaceMember(wsId, other.id, "member");

    const tok = await signApprovalToken({
      userId,
      action: "reject",
      resourceType: "requirement_draft",
      resourceId: String(draftId),
    });
    const res = await approvalRoutes.request("/execute", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tok }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Batch 2-F: /api/memory/snapshot", () => {
  let userId: number;
  let token: string;
  let wsId: number;

  beforeEach(async () => {
    getDb();
    const u = upsertUser({ feishu_user_id: "ou_b2f_mem", name: "b2f-mem" });
    userId = u.id;
    token = await signJwt({ sub: u.id, role: "admin" });
    const ws = createWorkspace({ name: "M", slug: "m-ws" });
    wsId = ws.id;
    addWorkspaceMember(ws.id, userId, "admin");
  });
  afterEach(() => closeDb());

  it("aggregates drafts + workflows + user actions", async () => {
    const d = createDraft({ workspaceId: wsId, creatorId: userId });
    updateRequirementDraft(d.id, {
      issue_title: "T1",
      status: "review",
    });
    createWorkflowExecution({
      workflow_type: "prd_to_tech",
      trigger_source: "manual",
      plane_issue_id: "ISS-1",
    });
    recordUserAction({
      userId,
      workspaceId: wsId,
      actionType: "test.action",
      payload: { foo: "bar" },
    });

    const snap = buildMemorySnapshot(wsId);
    expect(snap.workspace_id).toBe(wsId);
    expect(snap.active_drafts.length).toBe(1);
    expect(snap.active_drafts[0].issue_title).toBe("T1");
    expect(snap.running_workflows.length).toBeGreaterThan(0);
    expect(snap.recent_user_actions.length).toBe(1);
    expect(snap.recent_user_actions[0].action_type).toBe("test.action");
  });

  it("GET endpoint requires workspace_id and membership", async () => {
    const res1 = await apiRoutes.request("/memory/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res1.status).toBe(400);

    const res2 = await apiRoutes.request(`/memory/snapshot?workspace_id=${wsId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.workspace_id).toBe(wsId);
  });

  it("returns 403 for non-member workspace", async () => {
    const other = createWorkspace({ name: "Other", slug: "other-ws" });
    const res = await apiRoutes.request(`/memory/snapshot?workspace_id=${other.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("Batch 2-F: /api/nanoclaw/dispatch", () => {
  const originalUrl = process.env.NANOCLAW_URL;
  const originalSecret = process.env.NANOCLAW_DISPATCH_SECRET;

  beforeEach(() => {
    getDb();
    process.env.NANOCLAW_DISPATCH_SECRET = "test-secret";
    delete process.env.NANOCLAW_URL;
  });
  afterEach(() => {
    closeDb();
    if (originalUrl) process.env.NANOCLAW_URL = originalUrl;
    else delete process.env.NANOCLAW_URL;
    if (originalSecret) process.env.NANOCLAW_DISPATCH_SECRET = originalSecret;
    else delete process.env.NANOCLAW_DISPATCH_SECRET;
  });

  it("503 when secret not configured", async () => {
    delete process.env.NANOCLAW_DISPATCH_SECRET;
    const res = await apiRoutes.request("/nanoclaw/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });

  it("403 when X-System-Secret missing/mismatched", async () => {
    const res = await apiRoutes.request("/nanoclaw/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-System-Secret": "wrong",
      },
      body: JSON.stringify({ skill: "x", workspace_id: 1 }),
    });
    expect(res.status).toBe(403);
  });

  it("400 when skill / workspace_id missing", async () => {
    const res = await apiRoutes.request("/nanoclaw/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-System-Secret": "test-secret",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("records action and returns dispatch_id when NANOCLAW_URL unset", async () => {
    const u = upsertUser({ feishu_user_id: "ou_b2f_disp", name: "disp" });
    const ws = createWorkspace({ name: "D", slug: "d-ws" });
    const res = await apiRoutes.request("/nanoclaw/dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-System-Secret": "test-secret",
      },
      body: JSON.stringify({
        skill: "arcflow-tech-design",
        workspace_id: ws.id,
        plane_issue_id: "ISS-42",
        user_id: u.id,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dispatched).toBe(false);
    expect(body.dispatch_id).toMatch(/^disp-/);

    const actions = buildMemorySnapshot(ws.id).recent_user_actions;
    expect(actions[0].action_type).toBe("nanoclaw.dispatch.arcflow-tech-design");
  });
});
