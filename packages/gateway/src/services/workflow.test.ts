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
const createWorkflowSubtask = mock(() => 1001);
const insertDispatch = mock(() => "dispatch-1");

mock.module("../db/queries", () => ({
  createWorkflowExecution,
  updateWorkflowStatus,
  getWorkspace,
  createWorkflowSubtask,
  insertDispatch,
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

const dispatchToNanoclaw = mock(() =>
  Promise.resolve({
    dispatchId: "dispatch-1",
    dispatched: true,
    nanoclawStatus: 200,
  }),
);
mock.module("./nanoclaw-dispatch", () => ({
  dispatchToNanoclaw,
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
  createWorkflowSubtask.mockClear();
  insertDispatch.mockClear();
  dispatchToNanoclaw.mockClear();
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
    createWorkflowExecution.mockReturnValue(42);
    runClaudeCode.mockReturnValue(Promise.resolve({ success: true, output: "code generated" }));
  });

  it("creates backend subtask and dispatches code_gen through NanoClaw", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-120",
    });
    await tick();

    expect(createWorkflowSubtask).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 42,
        target: "backend",
        stage: "dispatch",
        provider: "nanoclaw",
      }),
    );
    expect(dispatchToNanoclaw).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "1",
        skill: "arcflow-code-gen",
        planeIssueId: "ISS-120",
      }),
    );
    expect(runClaudeCode).not.toHaveBeenCalled();
  });

  it("creates one subtask and dispatch per target repo", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      target_repos: ["backend", "vue3"],
      plane_issue_id: "ISS-11",
    });
    await tick();

    expect(createWorkflowSubtask).toHaveBeenCalledTimes(2);
    expect(dispatchToNanoclaw).toHaveBeenCalledTimes(2);
    expect(runClaudeCode).not.toHaveBeenCalled();
  });

  it("reads docs input once and includes task_context in dispatch payload", async () => {
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
    expect(dispatchToNanoclaw).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          task_context: "file content",
          input_path: "tech-design/2026-04/feature-x.md",
        }),
      }),
    );
  });

  it("includes figma_url in dispatch payload", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      figma_url: "https://figma.com/file/abc",
      plane_issue_id: "ISS-13",
    });
    await tick();

    expect(dispatchToNanoclaw).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          figma_url: "https://figma.com/file/abc",
        }),
      }),
    );
  });

  it("keeps workflow running after dispatch without sending chat success notification", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      chat_id: "chat-99",
      plane_issue_id: "ISS-14",
    });
    await tick();

    expect(updateWorkflowStatus).not.toHaveBeenCalledWith(42, "success");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("fails early for invalid target_repos", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      target_repos: ["ios"],
      plane_issue_id: "ISS-404",
    });
    await tick();

    expect(createWorkflowSubtask).not.toHaveBeenCalled();
    expect(dispatchToNanoclaw).not.toHaveBeenCalled();
    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      42,
      "failed",
      expect.stringContaining("invalid target repo"),
    );
  });

  it("fails when dispatch result reports dispatched false", async () => {
    dispatchToNanoclaw.mockResolvedValueOnce({
      dispatchId: "dispatch-2",
      dispatched: false,
      error: "nanoclaw unavailable",
    });

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-500",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      42,
      "failed",
      expect.stringContaining("nanoclaw unavailable"),
    );
  });

  it("fails when NanoClaw responds with non-2xx status", async () => {
    dispatchToNanoclaw.mockResolvedValueOnce({
      dispatchId: "dispatch-3",
      dispatched: true,
      nanoclawStatus: 500,
    });

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-501",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      42,
      "failed",
      expect.stringContaining("NanoClaw dispatch returned status 500"),
    );
  });
});

describe("error handling", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(99);
  });

  it("sends failure notification when workflow errors with chat_id", async () => {
    dispatchToNanoclaw.mockImplementation(() => {
      throw new Error("dispatch enqueue failed");
    });

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "manual",
      chat_id: "chat-err",
      plane_issue_id: "ISS-99",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(99, "failed", "dispatch enqueue failed");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toBe("chat-err");
  });

  it("does not send notification when no chat_id", async () => {
    dispatchToNanoclaw.mockImplementation(() => {
      throw new Error("fail");
    });

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
