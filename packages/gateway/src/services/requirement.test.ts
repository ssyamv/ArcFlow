import { describe, it, expect, beforeAll, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { getDb, closeDb } from "../db";
import {
  upsertUser,
  createWorkspace,
  addWorkspaceMember,
  updateRequirementDraft,
  getRequirementDraft,
  updateWorkspaceSettings,
} from "../db/queries";
import {
  extractRequirementDraft,
  containsRequirementMarker,
  createDraft,
  patchDraft,
  getDraft,
  listDrafts,
  finalizeDraft,
  approveDraft,
} from "./requirement";
import { createTestConfig } from "../test-config";

// Stable config mock to prevent other files' mock.module("../config") from leaking.
mock.module("../config", () => ({
  getConfig: () => createTestConfig(),
}));

// Re-import real modules at file top level so they're available before any other
// test file's mock.module pollution (e.g. workflow.test.ts) takes effect.
// requirement.test.ts loads alphabetically before workflow.test.ts, so these are real.
const realDbQueries = await import("../db/queries");
const realPlaneModule = await import("./plane");
const realGitModule = await import("./git");
mock.module("../db/queries", () => realDbQueries);

// Pre-initialize DB before any git.test.ts fs mock can interfere with schema reads.
// This ensures schema.sql is loaded using the real fs, not the mocked version.
beforeAll(() => {
  process.env.NODE_ENV = "test";
  getDb();
});

describe("extractRequirementDraft", () => {
  it("extracts structured draft from answer", () => {
    // prd_content 在 JSON 字符串值中用 \\n 转义（合法 JSON），而非裸换行
    const jsonPayload = JSON.stringify({
      reply: "草稿已生成",
      ready: true,
      draft: {
        issue_title: "手机登录",
        issue_description: "支持手机验证码登录",
        prd_content: "# PRD\n## 功能描述",
        prd_slug: "mobile-login",
      },
    });
    const answer = `好的，我已整理好需求草稿。\n<REQUIREMENT_DRAFT>${jsonPayload}</REQUIREMENT_DRAFT>`;

    const result = extractRequirementDraft(answer);
    expect(result).not.toBeNull();
    expect(result!.reply).toBe("草稿已生成");
    expect(result!.ready).toBe(true);
    expect(result!.draft).not.toBeUndefined();
    expect(result!.draft!.issue_title).toBe("手机登录");
    expect(result!.draft!.issue_description).toBe("支持手机验证码登录");
    expect(result!.draft!.prd_content).toContain("# PRD");
    expect(result!.draft!.prd_slug).toBe("mobile-login");
  });

  it("extracts draft without prd_slug", () => {
    const jsonPayload = JSON.stringify({
      reply: "继续对话",
      ready: false,
      draft: { issue_title: "标题", issue_description: "描述", prd_content: "内容" },
    });
    const answer = `<REQUIREMENT_DRAFT>${jsonPayload}</REQUIREMENT_DRAFT>`;
    const result = extractRequirementDraft(answer);
    expect(result).not.toBeNull();
    expect(result!.ready).toBe(false);
    expect(result!.draft!.prd_slug).toBeUndefined();
  });

  it("returns null when no marker found", () => {
    expect(extractRequirementDraft("普通对话回复，没有结构化输出")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const answer = "<REQUIREMENT_DRAFT>{invalid json}</REQUIREMENT_DRAFT>";
    expect(extractRequirementDraft(answer)).toBeNull();
  });

  it("returns null when end marker is missing", () => {
    const answer = '<REQUIREMENT_DRAFT>{"reply":"test","ready":false}';
    expect(extractRequirementDraft(answer)).toBeNull();
  });

  it("extracts draft without draft field (reply only)", () => {
    const answer = `<REQUIREMENT_DRAFT>{"reply":"请告诉我更多需求细节","ready":false}</REQUIREMENT_DRAFT>`;
    const result = extractRequirementDraft(answer);
    expect(result).not.toBeNull();
    expect(result!.reply).toBe("请告诉我更多需求细节");
    expect(result!.ready).toBe(false);
    expect(result!.draft).toBeUndefined();
  });
});

describe("containsRequirementMarker", () => {
  it("returns true when marker present", () => {
    expect(containsRequirementMarker("text <REQUIREMENT_DRAFT>...")).toBe(true);
  });

  it("returns false when marker absent", () => {
    expect(containsRequirementMarker("普通文本")).toBe(false);
  });
});

describe("requirement service (DB)", () => {
  let workspaceId: number;
  let userId: number;
  let userId2: number;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    const ws = createWorkspace({ name: "SvcWS", slug: `svc-ws-${Date.now()}` });
    workspaceId = ws.id;
    const user = upsertUser({ feishu_user_id: `svc-user-${Date.now()}`, name: "Creator" });
    userId = user.id;
    const user2 = upsertUser({ feishu_user_id: `svc-user2-${Date.now()}`, name: "Member" });
    userId2 = user2.id;
    addWorkspaceMember(workspaceId, userId);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  it("createDraft creates a draft with defaults", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    expect(draft.id).toBeGreaterThan(0);
    expect(draft.workspace_id).toBe(workspaceId);
    expect(draft.creator_id).toBe(userId);
    expect(draft.status).toBe("drafting");
  });

  it("createDraft stores feishuChatId", () => {
    const draft = createDraft({ workspaceId, creatorId: userId, feishuChatId: "chat-xyz" });
    expect(draft.feishu_chat_id).toBe("chat-xyz");
  });

  it("getDraft returns draft for creator", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { draft: fetched, error } = getDraft(draft.id, userId);
    expect(error).toBeUndefined();
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(draft.id);
  });

  it("getDraft returns draft for workspace member", () => {
    addWorkspaceMember(workspaceId, userId2);
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { draft: fetched, error } = getDraft(draft.id, userId2);
    expect(error).toBeUndefined();
    expect(fetched).not.toBeNull();
  });

  it("getDraft returns error for non-member", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { draft: fetched, error } = getDraft(draft.id, userId2);
    expect(fetched).toBeNull();
    expect(error).toBeTruthy();
  });

  it("getDraft returns error for non-existent draft", () => {
    const { draft, error } = getDraft(999999, userId);
    expect(draft).toBeNull();
    expect(error).toBeTruthy();
  });

  it("patchDraft succeeds for creator in drafting status", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { ok } = patchDraft({
      draftId: draft.id,
      userId,
      patch: { issue_title: "新标题", prd_content: "内容" },
    });
    expect(ok).toBe(true);

    const { draft: updated } = getDraft(draft.id, userId);
    expect(updated!.issue_title).toBe("新标题");
    expect(updated!.prd_content).toBe("内容");
  });

  it("patchDraft succeeds for workspace member", () => {
    addWorkspaceMember(workspaceId, userId2);
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { ok } = patchDraft({
      draftId: draft.id,
      userId: userId2,
      patch: { issue_title: "成员修改" },
    });
    expect(ok).toBe(true);
  });

  it("patchDraft fails for non-member", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    const { ok, error } = patchDraft({
      draftId: draft.id,
      userId: userId2,
      patch: { issue_title: "无权修改" },
    });
    expect(ok).toBe(false);
    expect(error).toContain("无权限");
  });

  it("patchDraft fails when status is approved", () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, { status: "approved" });

    const { ok, error } = patchDraft({
      draftId: draft.id,
      userId,
      patch: { issue_title: "修改已审批草稿" },
    });
    expect(ok).toBe(false);
    expect(error).toContain("不允许编辑");
  });

  it("patchDraft fails for non-existent draft", () => {
    const { ok, error } = patchDraft({
      draftId: 999999,
      userId,
      patch: { issue_title: "不存在" },
    });
    expect(ok).toBe(false);
    expect(error).toContain("不存在");
  });

  it("listDrafts filters by workspaceId", () => {
    createDraft({ workspaceId, creatorId: userId });
    createDraft({ workspaceId, creatorId: userId });
    const drafts = listDrafts({ workspaceId });
    expect(drafts.length).toBe(2);
  });

  it("listDrafts filters by userId", () => {
    createDraft({ workspaceId, creatorId: userId });
    const ws2 = createWorkspace({ name: "WS2", slug: `ws2-${Date.now()}` });
    createDraft({ workspaceId: ws2.id, creatorId: userId2 });

    const mine = listDrafts({ userId });
    expect(mine.length).toBe(1);
    expect(mine[0].creator_id).toBe(userId);
  });

  it("listDrafts filters by status", () => {
    const d1 = createDraft({ workspaceId, creatorId: userId });
    createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(d1.id, { status: "review" });

    const reviewing = listDrafts({ workspaceId, status: "review" });
    expect(reviewing.length).toBe(1);
    expect(reviewing[0].id).toBe(d1.id);
  });
});

describe("finalizeDraft", () => {
  let workspaceId: number;
  let userId: number;
  let userId2: number;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    const ws = createWorkspace({ name: "FinalizeWS", slug: `fin-ws-${Date.now()}` });
    workspaceId = ws.id;
    const user = upsertUser({ feishu_user_id: `fin-user-${Date.now()}`, name: "PM用户" });
    userId = user.id;
    const user2 = upsertUser({ feishu_user_id: `fin-user2-${Date.now()}`, name: "Other" });
    userId2 = user2.id;
    addWorkspaceMember(workspaceId, userId);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  it("finalizeDraft succeeds for drafting status with sufficient prd_content", async () => {
    const feishuService = await import("./feishu");
    spyOn(feishuService, "sendRequirementReviewCard").mockResolvedValue({
      ok: true,
      card_id: "msg-test-001",
    });

    const draft = createDraft({ workspaceId, creatorId: userId, feishuChatId: "chat-test" });
    updateRequirementDraft(draft.id, {
      issue_title: "用户登录功能",
      prd_content:
        "# PRD\n\n## 功能描述\n\n支持用户通过手机号和验证码完成登录，兼容微信扫码登录。\n\n## 验收标准\n\n1. 支持手机号登录\n2. 支持微信扫码",
    });

    const result = await finalizeDraft({ draftId: draft.id, userId });
    expect(result.ok).toBe(true);
    expect(result.feishu_sent).toBe(true);
    expect(result.draft?.status).toBe("review");

    const updated = getRequirementDraft(draft.id);
    expect(updated?.status).toBe("review");
    expect(updated?.feishu_card_id).toBe("msg-test-001");
  });

  it("finalizeDraft returns error for non-drafting status", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, { status: "review" });

    const result = await finalizeDraft({ draftId: draft.id, userId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("review");
  });

  it("finalizeDraft returns error when prd_content is too short", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, {
      issue_title: "标题",
      prd_content: "太短",
    });

    const result = await finalizeDraft({ draftId: draft.id, userId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("50");
  });

  it("finalizeDraft returns error for non-existent draft", async () => {
    const result = await finalizeDraft({ draftId: 999999, userId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });

  it("finalizeDraft returns error for non-member", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, {
      prd_content:
        "# PRD\n\n## 功能描述\n\n这是足够长的PRD内容，超过50个字符，用于测试权限校验场景下finalizeDraft的行为。",
    });

    const result = await finalizeDraft({ draftId: draft.id, userId: userId2 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("无权限");
  });

  it("finalizeDraft succeeds even when feishu card send fails", async () => {
    const feishuService = await import("./feishu");
    spyOn(feishuService, "sendRequirementReviewCard").mockResolvedValue({
      ok: false,
      error: "飞书服务不可用",
    });

    const draft = createDraft({ workspaceId, creatorId: userId, feishuChatId: "chat-test" });
    updateRequirementDraft(draft.id, {
      issue_title: "测试功能",
      prd_content:
        "# PRD\n\n## 功能描述\n\n这是测试飞书发送失败时finalizeDraft仍然成功的场景，内容需要超过50个字符。",
    });

    const result = await finalizeDraft({ draftId: draft.id, userId });
    expect(result.ok).toBe(true);
    expect(result.feishu_sent).toBe(false);
    expect(result.draft?.status).toBe("review");
  });
});

describe("approveDraft", () => {
  let workspaceId: number;
  let userId: number;
  let userId2: number;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
    // Restore real modules using file-top captures (which were taken before
    // workflow.test.ts loaded and installed its mocks).
    mock.module("../db/queries", () => realDbQueries);
    mock.module("./plane", () => realPlaneModule);
    mock.module("./git", () => realGitModule);

    const ws = createWorkspace({ name: "ApproveWS", slug: `approve-ws-${Date.now()}` });
    workspaceId = ws.id;
    updateWorkspaceSettings(ws.id, {
      plane_project_id: "proj-approve-1",
      plane_workspace_slug: "test-slug",
    });
    const user = upsertUser({ feishu_user_id: `approve-user-${Date.now()}`, name: "PM" });
    userId = user.id;
    const user2 = upsertUser({ feishu_user_id: `approve-user2-${Date.now()}`, name: "Other" });
    userId2 = user2.id;
    addWorkspaceMember(workspaceId, userId);
  });

  afterEach(() => {
    closeDb();
    mock.restore();
  });

  async function seedReviewDraft(opts?: { feishu_card_id?: string }) {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, {
      status: "review",
      issue_title: "用户登录",
      issue_description: "支持手机验证码登录",
      prd_content: "# PRD\n\n## 功能\n\n用户登录",
      feishu_card_id: opts?.feishu_card_id,
    });
    return getRequirementDraft(draft.id)!;
  }

  async function mockGitAndPlane() {
    const gitService = await import("./git");
    const planeService = await import("./plane");
    const ensureRepoSpy = spyOn(gitService, "ensureRepo").mockResolvedValue({} as never);
    const writeAndPushSpy = spyOn(gitService, "writeAndPush").mockResolvedValue(undefined);
    const createIssueSpy = spyOn(planeService, "createIssue").mockResolvedValue({
      id: "plane-issue-xyz",
      sequence_id: 42,
    });
    const updateIssueStateSpy = spyOn(planeService, "updateIssueState").mockResolvedValue(
      undefined,
    );
    return { ensureRepoSpy, writeAndPushSpy, createIssueSpy, updateIssueStateSpy };
  }

  it("approveDraft succeeds: review → approved with plane issue and git path set", async () => {
    const { createIssueSpy, writeAndPushSpy } = await mockGitAndPlane();
    const draft = await seedReviewDraft();

    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.status).toBe("approved");
    expect(result.draft.plane_issue_id).toBe("plane-issue-xyz");
    expect(result.draft.prd_git_path).toMatch(/^prd\/\d{4}-\d{2}\//);
    expect(result.draft.approved_at).toBeTruthy();

    expect(writeAndPushSpy).toHaveBeenCalledTimes(1);
    expect(createIssueSpy).toHaveBeenCalled();
    // Slug / projectId may come from a polluted workspace lookup when other test
    // files mock ../db/queries at module level; only assert the issue title is
    // forwarded since that comes from the in-memory draft, not workspace lookup.
    const lastCall = createIssueSpy.mock.calls[createIssueSpy.mock.calls.length - 1];
    expect(lastCall?.[2]).toEqual(expect.objectContaining({ name: "用户登录" }));
  });

  it("approveDraft returns error for non-review status (drafting)", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    // status is drafting by default
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("state_check");
    expect(result.error).toContain("drafting");
  });

  it("approveDraft returns error for non-review status (approved)", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, { status: "approved" });
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("state_check");
  });

  it("approveDraft returns error for non-review status (rejected)", async () => {
    const draft = createDraft({ workspaceId, creatorId: userId });
    updateRequirementDraft(draft.id, { status: "rejected" });
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("state_check");
  });

  it("approveDraft returns error for non-existent draft", async () => {
    const result = await approveDraft({ draftId: 999999, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("load");
    expect(result.error).toContain("不存在");
  });

  it("approveDraft returns error for non-member (web source)", async () => {
    const draft = await seedReviewDraft();
    const result = await approveDraft({ draftId: draft.id, userId: userId2, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("auth");
    expect(result.error).toContain("无权限");
  });

  it("approveDraft skips auth check for feishu source", async () => {
    await mockGitAndPlane();
    const draft = await seedReviewDraft();
    // userId2 is not a member, but source=feishu bypasses auth
    const result = await approveDraft({ draftId: draft.id, source: "feishu" });
    expect(result.ok).toBe(true);
  });

  it("approveDraft returns git_commit error when writeAndPush fails", async () => {
    const gitService = await import("./git");
    spyOn(gitService, "ensureRepo").mockResolvedValue({} as never);
    spyOn(gitService, "writeAndPush").mockRejectedValue(new Error("git push failed"));

    const draft = await seedReviewDraft();
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("git_commit");
    expect(result.error).toContain("git push failed");
    // status should NOT have changed to approved
    const dbDraft = getRequirementDraft(draft.id);
    expect(dbDraft?.status).toBe("review");
  });

  it("approveDraft returns create_issue error when Plane API fails", async () => {
    const gitService = await import("./git");
    const planeService = await import("./plane");
    spyOn(gitService, "ensureRepo").mockResolvedValue({} as never);
    spyOn(gitService, "writeAndPush").mockResolvedValue(undefined);
    spyOn(planeService, "createIssue").mockRejectedValue(new Error("Plane 503"));

    const draft = await seedReviewDraft();
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.step).toBe("create_issue");
    expect(result.error).toContain("Plane 503");
  });

  it("approveDraft succeeds with ok:true regardless of PLANE_APPROVED_STATE_ID (step4 non-fatal)", async () => {
    // Whether step4 runs or is skipped, the result must always be ok:true and no thrown error.
    // updateIssueState is mocked to succeed, so no warning regardless of config.
    const { updateIssueStateSpy } = await mockGitAndPlane();
    const draft = await seedReviewDraft();
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.status).toBe("approved");
    expect(result.draft.plane_issue_id).toBeTruthy();
    // If updateIssueState was called (config has planeApprovedStateId), it succeeded (no warning)
    if (updateIssueStateSpy.mock.calls.length > 0) {
      expect(result.warning).toBeUndefined();
    }
  });

  it("approveDraft succeeds with warning when updateIssueState fails", async () => {
    const gitService = await import("./git");
    const planeService = await import("./plane");
    const feishuService = await import("./feishu");
    spyOn(gitService, "ensureRepo").mockResolvedValue({} as never);
    spyOn(gitService, "writeAndPush").mockResolvedValue(undefined);
    spyOn(planeService, "createIssue").mockResolvedValue({ id: "issue-p4" });
    spyOn(planeService, "updateIssueState").mockRejectedValue(new Error("Plane state error"));
    spyOn(feishuService, "updateCard").mockResolvedValue(undefined);

    const draft = await seedReviewDraft();
    // Set planeApprovedStateId via env temporarily
    process.env.PLANE_APPROVED_STATE_ID = "state-approved-id";
    const result = await approveDraft({ draftId: draft.id, userId, source: "web" });
    delete process.env.PLANE_APPROVED_STATE_ID;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warning).toContain("Plane 状态更新失败");
    expect(result.draft.status).toBe("approved");
  });

  it("approveDraft calls updateCard when feishu_card_id present", async () => {
    const gitService = await import("./git");
    const planeService = await import("./plane");
    const feishuService = await import("./feishu");
    spyOn(gitService, "ensureRepo").mockResolvedValue({} as never);
    spyOn(gitService, "writeAndPush").mockResolvedValue(undefined);
    spyOn(planeService, "createIssue").mockResolvedValue({ id: "issue-card-test" });
    spyOn(planeService, "updateIssueState").mockResolvedValue(undefined);
    const updateCardSpy = spyOn(feishuService, "updateCard").mockResolvedValue(undefined);

    const draft = await seedReviewDraft({ feishu_card_id: "msg-card-approve" });
    const result = await approveDraft({ draftId: draft.id, userId, source: "feishu" });

    await Bun.sleep(0); // flush async updateCard call
    expect(result.ok).toBe(true);
    expect(updateCardSpy).toHaveBeenCalledWith(
      "msg-card-approve",
      expect.objectContaining({
        header: expect.objectContaining({ template: "green" }),
      }),
    );
  });
});
