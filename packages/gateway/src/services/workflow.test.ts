import { describe, expect, it, mock, beforeEach } from "bun:test";

// --- Mock db/queries ---
const createWorkflowExecution = mock(() => 42);
const updateWorkflowStatus = mock(() => {});
const createBugFixRetry = mock(() => {});
const getBugFixRetry = mock(() => ({ issue_id: "bug-1", retry_count: 0, status: "open" }));
const incrementBugFixRetry = mock(() => {});
const updateBugFixStatus = mock(() => {});

mock.module("../db/queries", () => ({
  createWorkflowExecution,
  updateWorkflowStatus,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
}));

// --- Mock git ---
const ensureRepo = mock(() => Promise.resolve());
const readFileMock = mock(() => Promise.resolve("file content"));
const writeAndPush = mock(() => Promise.resolve());
const createBranchAndPush = mock(() => Promise.resolve());

mock.module("./git", () => ({
  ensureRepo,
  readFile: readFileMock,
  writeAndPush,
  createBranchAndPush,
}));

// --- Mock dify ---
const generateTechDoc = mock(() => Promise.resolve("tech doc content"));
const generateOpenApi = mock(() => Promise.resolve("openapi content"));
const analyzeBug = mock(() => Promise.resolve("bug report"));

mock.module("./dify", () => ({
  generateTechDoc,
  generateOpenApi,
  analyzeBug,
}));

// --- Mock plane ---
const createBugIssue = mock(() => Promise.resolve({ id: "bug-issue-1" }));

mock.module("./plane", () => ({
  createBugIssue,
}));

// --- Mock feishu ---
const sendTechReviewCard = mock(() => Promise.resolve());
const sendNotification = mock(() => Promise.resolve());
const sendBugNotification = mock(() => Promise.resolve());

mock.module("./feishu", () => ({
  sendTechReviewCard,
  sendNotification,
  sendBugNotification,
}));

// --- Mock wikijs ---
const triggerSync = mock(() => Promise.resolve());

mock.module("./wikijs", () => ({
  triggerSync,
}));

// --- Mock claude-code ---
const runClaudeCode = mock(() => Promise.resolve({ success: true, output: "done" }));

mock.module("./claude-code", () => ({
  runClaudeCode,
}));

// --- Mock config ---
mock.module("../config", () => ({
  getConfig: () => ({
    gitWorkDir: "/tmp/test-workdir",
  }),
}));

const { triggerWorkflow } = await import("./workflow");

function clearAllMocks() {
  createWorkflowExecution.mockClear();
  updateWorkflowStatus.mockClear();
  createBugFixRetry.mockClear();
  getBugFixRetry.mockClear();
  incrementBugFixRetry.mockClear();
  updateBugFixStatus.mockClear();
  ensureRepo.mockClear();
  readFileMock.mockClear();
  writeAndPush.mockClear();
  createBranchAndPush.mockClear();
  generateTechDoc.mockClear();
  generateOpenApi.mockClear();
  analyzeBug.mockClear();
  createBugIssue.mockClear();
  sendTechReviewCard.mockClear();
  sendNotification.mockClear();
  sendBugNotification.mockClear();
  triggerSync.mockClear();
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
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    expect(id).toBe(42);
  });

  it("creates workflow execution record with correct params", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "api",
      plane_issue_id: "ISS-1",
      input_path: "prd/feature-x.md",
    });

    expect(createWorkflowExecution).toHaveBeenCalledWith({
      workflow_type: "prd_to_tech",
      trigger_source: "api",
      plane_issue_id: "ISS-1",
      input_path: "prd/feature-x.md",
    });
  });

  it("sets status to running", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });

    expect(updateWorkflowStatus).toHaveBeenCalledWith(42, "running");
  });
});

describe("flowPrdToTech", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(1);
  });

  it("reads PRD, generates tech doc and OpenAPI, writes both to git", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-login.md",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("docs");
    expect(readFileMock).toHaveBeenCalledWith("docs", "prd/feature-login.md");
    expect(generateTechDoc).toHaveBeenCalledWith("file content");
    expect(generateOpenApi).toHaveBeenCalledWith("tech doc content");

    // Two writes: tech doc + openapi
    expect(writeAndPush).toHaveBeenCalledTimes(2);
    // First write is tech doc
    expect(writeAndPush.mock.calls[0][0]).toBe("docs");
    expect(writeAndPush.mock.calls[0][1]).toContain("tech-design/");
    expect(writeAndPush.mock.calls[0][1]).toContain("feature-login.md");
    // Second write is openapi
    expect(writeAndPush.mock.calls[1][1]).toContain("api/");
    expect(writeAndPush.mock.calls[1][1]).toContain("feature-login.yaml");
  });

  it("triggers Wiki.js sync after each write", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(triggerSync).toHaveBeenCalledTimes(2);
  });

  it("sends Feishu review card when chat_id is provided", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
      chat_id: "chat-123",
    });
    await tick();

    expect(sendTechReviewCard).toHaveBeenCalledTimes(1);
    const args = sendTechReviewCard.mock.calls[0][0] as Record<string, string>;
    expect(args.chatId).toBe("chat-123");
    expect(args.featureName).toBe("feature-x");
  });

  it("does not send Feishu card when no chat_id", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(sendTechReviewCard).not.toHaveBeenCalled();
  });

  it("fails with error when input_path is missing", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      1,
      "failed",
      "input_path is required for prd_to_tech",
    );
  });

  it("sets status to success on completion", async () => {
    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(1, "success");
  });
});

describe("flowTechToOpenApi", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(2);
  });

  it("reads tech doc and generates OpenAPI", async () => {
    await triggerWorkflow({
      workflow_type: "tech_to_openapi",
      trigger_source: "api",
      input_path: "tech-design/2026-04/feature-x.md",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("docs");
    expect(readFileMock).toHaveBeenCalledWith("docs", "tech-design/2026-04/feature-x.md");
    expect(generateOpenApi).toHaveBeenCalledWith("file content");
    expect(writeAndPush).toHaveBeenCalledTimes(1);
    expect(writeAndPush.mock.calls[0][1]).toContain("api/");
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it("fails when input_path missing", async () => {
    await triggerWorkflow({
      workflow_type: "tech_to_openapi",
      trigger_source: "api",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      2,
      "failed",
      "input_path is required for tech_to_openapi",
    );
  });
});

describe("flowBugAnalysis", () => {
  beforeEach(() => {
    clearAllMocks();
    createWorkflowExecution.mockReturnValue(3);
    getBugFixRetry.mockReturnValue({ issue_id: "bug-issue-1", retry_count: 0, status: "open" });
    runClaudeCode.mockReturnValue(Promise.resolve({ success: true, output: "fixed" }));
  });

  it("analyzes bug, creates Plane issue, and attempts auto-fix", async () => {
    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      input_path: "CI log content here",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
    });
    await tick();

    expect(analyzeBug).toHaveBeenCalledWith("CI log content here", "ISS-5");
    expect(createBugIssue).toHaveBeenCalledTimes(1);
    expect(createBugFixRetry).toHaveBeenCalledWith("bug-issue-1");
    expect(incrementBugFixRetry).toHaveBeenCalledWith("bug-issue-1");
    expect(runClaudeCode).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush).toHaveBeenCalledTimes(1);
    expect(updateBugFixStatus).toHaveBeenCalledWith("bug-issue-1", "fixed");
  });

  it("sends success notification when chat_id provided and fix succeeds", async () => {
    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      input_path: "CI log",
      project_id: "proj-1",
      chat_id: "chat-1",
    });
    await tick();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const args = sendNotification.mock.calls[0];
    expect(args[0]).toBe("chat-1");
  });

  it("sends failure notification when auto-fix fails", async () => {
    runClaudeCode.mockReturnValue(Promise.resolve({ success: false, error: "compile error" }));

    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      input_path: "CI log",
      project_id: "proj-1",
      chat_id: "chat-1",
    });
    await tick();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const msg = sendNotification.mock.calls[0][2] as string;
    expect(msg).toContain("修复失败");
  });

  it("escalates when retry count >= 2", async () => {
    getBugFixRetry.mockReturnValue({ issue_id: "bug-issue-1", retry_count: 2, status: "open" });

    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      input_path: "CI log",
      project_id: "proj-1",
      chat_id: "chat-1",
    });
    await tick();

    expect(updateBugFixStatus).toHaveBeenCalledWith("bug-issue-1", "escalated");
    expect(sendBugNotification).toHaveBeenCalledTimes(1);
    expect(runClaudeCode).not.toHaveBeenCalled();
  });

  it("fails when input_path missing", async () => {
    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      project_id: "proj-1",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(3, "failed", "CI log content is required");
  });

  it("fails when project_id missing", async () => {
    await triggerWorkflow({
      workflow_type: "bug_analysis",
      trigger_source: "webhook",
      input_path: "CI log",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(3, "failed", "project_id is required");
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
      workflow_type: "code_gen",
      trigger_source: "api",
      plane_issue_id: "ISS-10",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("backend");
    expect(runClaudeCode).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush.mock.calls[0][1]).toContain("feature/ISS-10-backend");
  });

  it("generates code for multiple repos", async () => {
    await triggerWorkflow({
      workflow_type: "code_gen",
      trigger_source: "api",
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
      workflow_type: "code_gen",
      trigger_source: "api",
      input_path: "tech-design/2026-04/feature-x.md",
      plane_issue_id: "ISS-12",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("docs");
    expect(readFileMock).toHaveBeenCalledWith("docs", "tech-design/2026-04/feature-x.md");
  });

  it("passes figma_url to runClaudeCode", async () => {
    await triggerWorkflow({
      workflow_type: "code_gen",
      trigger_source: "api",
      figma_url: "https://figma.com/file/abc",
      plane_issue_id: "ISS-13",
    });
    await tick();

    const ccArgs = runClaudeCode.mock.calls[0];
    expect(ccArgs[2]).toEqual({ figmaUrl: "https://figma.com/file/abc" });
  });

  it("sends notification on success when chat_id provided", async () => {
    await triggerWorkflow({
      workflow_type: "code_gen",
      trigger_source: "api",
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
      workflow_type: "code_gen",
      trigger_source: "api",
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
    generateTechDoc.mockReturnValue(Promise.reject(new Error("Dify timeout")));

    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
      chat_id: "chat-err",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(99, "failed", "Dify timeout");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toBe("chat-err");
  });

  it("does not send notification when no chat_id", async () => {
    generateTechDoc.mockReturnValue(Promise.reject(new Error("fail")));

    await triggerWorkflow({
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
