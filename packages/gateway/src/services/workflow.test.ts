import { describe, expect, it, mock, beforeEach, afterAll, spyOn } from "bun:test";

// Cache real modules before mock.module replaces them, so we can restore later.
const realDbQueries = await import("../db/queries");

// --- Mock db/queries (safe: queries.test.ts runs before this file) ---
const createWorkflowExecution = mock(() => 42);
const updateWorkflowStatus = mock(() => {});
const getWorkspace = mock(() => ({
  id: 1,
  name: "Test WS",
  slug: "test-ws",
  plane_project_id: "proj-1",
  plane_workspace_slug: "plane-ws",
  wiki_path_prefix: null,
  git_repos: JSON.stringify({
    docs: "git@ex:docs.git",
    backend: "git@ex:be.git",
    vue3: "git@ex:vue3.git",
  }),
  feishu_chat_id: null,
  created_at: "",
  updated_at: "",
}));

mock.module("../db/queries", () => ({
  createWorkflowExecution,
  updateWorkflowStatus,
  getWorkspace,
  // Include all exports to avoid missing export errors for other importers
  recordWebhookEvent: mock(() => {}),
  isEventProcessed: mock(() => false),
  recordWebhookLog: mock(() => {}),
  listWebhookLogs: mock(() => []),
  cleanExpiredEvents: mock(() => 0),
  getWorkflowExecution: mock(() => null),
  listWorkflowExecutions: mock(() => ({ data: [], total: 0 })),
}));

// --- Mock git (safe: git.test.ts has its own mock.module) ---
const ensureRepo = mock(() => Promise.resolve());
const readFileMock = mock(() => Promise.resolve("file content"));
const createBranchAndPush = mock(() => Promise.resolve());
const registerRepoUrl = mock(() => {});

mock.module("./git", () => ({
  ensureRepo,
  readFile: readFileMock,
  createBranchAndPush,
  registerRepoUrl,
}));

// --- Mock config ---
import { createTestConfig } from "../test-config";
mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      gitWorkDir: "/tmp/test-workdir",
    }),
}));

// --- Use spyOn for modules that have their own test files downstream ---
const claudeCodeMod = await import("./claude-code");
const feishuMod = await import("./feishu");

const runClaudeCode = spyOn(claudeCodeMod, "runClaudeCode").mockResolvedValue({
  success: true,
  output: "done",
});
const sendNotification = spyOn(feishuMod, "sendNotification").mockResolvedValue(undefined);

const { triggerWorkflow } = await import("./workflow");

// Restore spied modules after all tests so downstream test files get the real implementations
afterAll(() => {
  runClaudeCode.mockRestore();
  sendNotification.mockRestore();
  // Restore db/queries so downstream test files get the real module implementations.
  mock.module("../db/queries", () => realDbQueries);
});

function clearAllMocks() {
  createWorkflowExecution.mockClear();
  updateWorkflowStatus.mockClear();
  ensureRepo.mockClear();
  readFileMock.mockClear();
  createBranchAndPush.mockClear();
  sendNotification.mockClear();
  runClaudeCode.mockClear();
}

// Helper: wait for async fire-and-forget to settle
const tick = () => new Promise((r) => setTimeout(r, 50));

describe("triggerWorkflow", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(42);
  });

  it("returns execution ID immediately", async () => {
    const id = await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
    });
    expect(id).toBe(42);
  });

  it("creates workflow execution record with correct params", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-1",
      input_path: "tech-design/feature-x.md",
    });

    expect(createWorkflowExecution).toHaveBeenCalledWith({
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-1",
      input_path: "tech-design/feature-x.md",
    });
  });

  it("sets status to running", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
    });

    expect(updateWorkflowStatus).toHaveBeenCalledWith(42, "running");
  });

  it("rejects unsupported workflow types with failed status", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "prd_to_tech",
      trigger_source: "manual",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      42,
      "failed",
      expect.stringContaining("no longer supported"),
    );
  });
});

describe("flowCodeGen", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(4);
    runClaudeCode.mockReturnValue(Promise.resolve({ success: true, output: "code generated" }));
  });

  it("generates code for default backend repo", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-10",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("ws-1-backend");
    expect(runClaudeCode).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush.mock.calls[0][1]).toContain("feature/ISS-10-backend");
  });

  it("generates code for multiple repos", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      target_repos: ["backend", "vue3"],
      plane_issue_id: "ISS-11",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledTimes(2);
    expect(runClaudeCode).toHaveBeenCalledTimes(2);
    expect(createBranchAndPush).toHaveBeenCalledTimes(2);
  });

  it("reads tech design doc when input_path provided", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      input_path: "tech-design/2026-04/feature-x.md",
      plane_issue_id: "ISS-12",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("ws-1-docs");
    expect(readFileMock).toHaveBeenCalledWith("ws-1-docs", "tech-design/2026-04/feature-x.md");
  });

  it("passes figma_url to runClaudeCode", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      figma_url: "https://figma.com/file/abc",
      plane_issue_id: "ISS-13",
    });
    await tick();

    const ccArgs = runClaudeCode.mock.calls[0];
    expect(ccArgs[2]).toEqual({ figmaUrl: "https://figma.com/file/abc" });
  });

  it("sends notification on success when chat_id provided", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      chat_id: "chat-99",
      plane_issue_id: "ISS-14",
    });
    await tick();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const msg = sendNotification.mock.calls[0][2] as string;
    expect(msg).toContain("代码已生成");
  });

  it("fails when code gen fails", async () => {
    runClaudeCode.mockReturnValue(Promise.resolve({ success: false, error: "syntax error" }));

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-15",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      4,
      "failed",
      expect.stringContaining("Code gen failed"),
    );
  });
});

describe("error handling", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(99);
  });

  it("sends failure notification when workflow errors with chat_id", async () => {
    runClaudeCode.mockReturnValue(Promise.reject(new Error("claude timeout")));

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      chat_id: "chat-err",
      plane_issue_id: "ISS-99",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(99, "failed", "claude timeout");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toBe("chat-err");
  });

  it("does not send notification when no chat_id", async () => {
    runClaudeCode.mockReturnValue(Promise.reject(new Error("fail")));

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-99",
    });
    await tick();

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
