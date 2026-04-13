import { describe, expect, it, mock, beforeEach, afterAll, spyOn } from "bun:test";

// Cache real modules before mock.module replaces them, so we can restore later.
const realDbQueries = await import("../db/queries");
const realDify = await import("./dify");

// --- Mock db/queries (safe: queries.test.ts runs before this file) ---
const createWorkflowExecution = mock(() => 42);
const updateWorkflowStatus = mock(() => {});
const createBugFixRetry = mock(() => {});
const getBugFixRetry = mock(() => ({ issue_id: "bug-1", retry_count: 0, status: "open" }));
const incrementBugFixRetry = mock(() => {});
const updateBugFixStatus = mock(() => {});
const getWorkspace = mock(() => ({
  id: 1,
  name: "Test WS",
  slug: "test-ws",
  plane_project_id: "proj-1",
  plane_workspace_slug: "plane-ws",
  dify_dataset_id: null,
  dify_rag_api_key: null,
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
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
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
const writeAndPush = mock(() => Promise.resolve());
const createBranchAndPush = mock(() => Promise.resolve());
const registerRepoUrl = mock(() => {});

mock.module("./git", () => ({
  ensureRepo,
  readFile: readFileMock,
  writeAndPush,
  createBranchAndPush,
  registerRepoUrl,
}));

// --- Mock dify (safe: dify.test.ts runs before this file) ---
const generateTechDoc = mock(() => Promise.resolve("tech doc content"));
const generateOpenApi = mock(() => Promise.resolve("openapi content"));
const analyzeBug = mock(() => Promise.resolve("bug report"));

// Stub `streamRequirementChatflow` too so requirement.ts (loaded by sibling tests
// running in the same Bun worker) can resolve its named import.
const streamRequirementChatflow = mock(() => (async function* () {})());

mock.module("./dify", () => ({
  generateTechDoc,
  generateOpenApi,
  analyzeBug,
  streamRequirementChatflow,
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
// This avoids mock.module pollution that would break claude-code.test.ts, plane.test.ts
const claudeCodeMod = await import("./claude-code");
const planeMod = await import("./plane");
const feishuMod = await import("./feishu");

const runClaudeCode = spyOn(claudeCodeMod, "runClaudeCode").mockResolvedValue({
  success: true,
  output: "done",
});
const createBugIssue = spyOn(planeMod, "createBugIssue").mockResolvedValue({ id: "bug-issue-1" });
const sendTechReviewCard = spyOn(feishuMod, "sendTechReviewCard").mockResolvedValue(undefined);
const sendNotification = spyOn(feishuMod, "sendNotification").mockResolvedValue(undefined);
const sendBugNotification = spyOn(feishuMod, "sendBugNotification").mockResolvedValue(undefined);

const { triggerWorkflow } = await import("./workflow");

// Restore spied modules after all tests so downstream test files get the real implementations
afterAll(() => {
  runClaudeCode.mockRestore();
  createBugIssue.mockRestore();
  sendTechReviewCard.mockRestore();
  sendNotification.mockRestore();
  sendBugNotification.mockRestore();
  // Restore db/queries and dify so downstream test files (e.g. requirement.test.ts)
  // that run in the same worker get the real module implementations.
  mock.module("../db/queries", () => realDbQueries);
  mock.module("./dify", () => realDify);
});

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
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    expect(id).toBe(42);
  });

  it("creates workflow execution record with correct params", async () => {
    await triggerWorkflow({
      workspace_id: 1,
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
      workspace_id: 1,
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
      workspace_id: 1,
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-login.md",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("ws-1-docs");
    expect(readFileMock).toHaveBeenCalledWith("ws-1-docs", "prd/feature-login.md");
    expect(generateTechDoc).toHaveBeenCalledWith("file content");
    expect(generateOpenApi).toHaveBeenCalledWith("tech doc content");

    // Two writes: tech doc + openapi
    expect(writeAndPush).toHaveBeenCalledTimes(2);
    // First write is tech doc
    expect(writeAndPush.mock.calls[0][0]).toBe("ws-1-docs");
    expect(writeAndPush.mock.calls[0][1]).toContain("tech-design/");
    expect(writeAndPush.mock.calls[0][1]).toContain("feature-login.md");
    // Second write is openapi
    expect(writeAndPush.mock.calls[1][1]).toContain("api/");
    expect(writeAndPush.mock.calls[1][1]).toContain("feature-login.yaml");
  });

  it("writes tech doc and openapi to git", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(writeAndPush).toHaveBeenCalledTimes(2);
  });

  it("sends Feishu review card when chat_id is provided", async () => {
    await triggerWorkflow({
      workspace_id: 1,
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
      workspace_id: 1,
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(sendTechReviewCard).not.toHaveBeenCalled();
  });

  it("fails with error when input_path is missing", async () => {
    await triggerWorkflow({
      workspace_id: 1,
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
      workspace_id: 1,
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
      workspace_id: 1,
      workflow_type: "tech_to_openapi",
      trigger_source: "api",
      input_path: "tech-design/2026-04/feature-x.md",
    });
    await tick();

    expect(ensureRepo).toHaveBeenCalledWith("ws-1-docs");
    expect(readFileMock).toHaveBeenCalledWith("ws-1-docs", "tech-design/2026-04/feature-x.md");
    expect(generateOpenApi).toHaveBeenCalledWith("file content");
    expect(writeAndPush).toHaveBeenCalledTimes(1);
    expect(writeAndPush.mock.calls[0][1]).toContain("api/");
  });

  it("fails when input_path missing", async () => {
    await triggerWorkflow({
      workspace_id: 1,
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
    // Default: first failure (no existing retry)
    getBugFixRetry.mockReturnValue(null);
    analyzeBug.mockReturnValue(Promise.resolve("bug report\n\n**严重级别:** P1"));
    runClaudeCode.mockReturnValue(Promise.resolve({ success: true, output: "fixed" }));
  });

  it("first failure: analyzes bug, creates Plane issue, and attempts auto-fix", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log content here",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
    });
    await tick();

    expect(analyzeBug).toHaveBeenCalledWith("CI log content here", "ISS-5");
    expect(createBugIssue).toHaveBeenCalledTimes(1);
    expect(createBugFixRetry).toHaveBeenCalledWith("ISS-5", "bug-issue-1");
    expect(incrementBugFixRetry).toHaveBeenCalledWith("ISS-5");
    expect(runClaudeCode).toHaveBeenCalledTimes(1);
    expect(createBranchAndPush).toHaveBeenCalledTimes(1);
    expect(updateBugFixStatus).toHaveBeenCalledWith("ISS-5", "fixed");
  });

  it("first failure: sends bug notification + success notification", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
      chat_id: "chat-1",
    });
    await tick();

    // Bug notification (initial detection)
    expect(sendBugNotification).toHaveBeenCalledTimes(1);
    // Success notification (auto-fix done)
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const msg = sendNotification.mock.calls[0][1] as string;
    expect(msg).toContain("自动修复完成");
  });

  it("retry: reuses existing bug issue, does not create new Plane issue", async () => {
    getBugFixRetry.mockReturnValue({
      plane_issue_id: "ISS-5",
      bug_issue_id: "BUG-1",
      retry_count: 1,
      status: "pending",
    });

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
    });
    await tick();

    expect(createBugIssue).not.toHaveBeenCalled();
    expect(createBugFixRetry).not.toHaveBeenCalled();
    expect(incrementBugFixRetry).toHaveBeenCalledWith("ISS-5");
    expect(runClaudeCode).toHaveBeenCalledTimes(1);
  });

  it("sends failure notification when auto-fix fails, sets status back to pending", async () => {
    runClaudeCode.mockReturnValue(
      Promise.resolve({ success: false, output: "", error: "compile error" }),
    );

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
      chat_id: "chat-1",
    });
    await tick();

    expect(updateBugFixStatus).toHaveBeenCalledWith("ISS-5", "pending");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const msg = sendNotification.mock.calls[0][2] as string;
    expect(msg).toContain("修复失败");
  });

  it("escalates when retry count >= 2 without calling Dify or Claude Code", async () => {
    getBugFixRetry.mockReturnValue({
      plane_issue_id: "ISS-5",
      bug_issue_id: "BUG-1",
      retry_count: 2,
      status: "pending",
    });

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
      chat_id: "chat-1",
    });
    await tick();

    expect(updateBugFixStatus).toHaveBeenCalledWith("ISS-5", "escalated");
    expect(sendBugNotification).toHaveBeenCalledTimes(1);
    expect(analyzeBug).not.toHaveBeenCalled();
    expect(runClaudeCode).not.toHaveBeenCalled();
  });

  it("parses severity from bug report", async () => {
    const p0Report = "error\n\n**严重级别:** P0\ndetails";
    analyzeBug.mockReset();
    analyzeBug.mockReturnValue(Promise.resolve(p0Report));

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-6",
      chat_id: "chat-1",
    });
    await tick();

    // Verify analyzeBug was called and returned P0 report
    expect(analyzeBug).toHaveBeenCalledTimes(1);
    const bugReportUsed = await analyzeBug.mock.results[0].value;
    expect(bugReportUsed).toContain("P0");

    // Bug notification should use parsed severity
    const severity = sendBugNotification.mock.calls[0][3] as string;
    expect(severity).toBe("P0");
    // Plane issue priority should be urgent for P0
    const issueParams = createBugIssue.mock.calls[0][2] as Record<string, string>;
    expect(issueParams.priority).toBe("urgent");
  });

  it("defaults severity to P1 when not parseable", async () => {
    analyzeBug.mockReturnValue(Promise.resolve("some bug report without severity"));

    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
      project_id: "proj-1",
      plane_issue_id: "ISS-5",
      chat_id: "chat-1",
    });
    await tick();

    const severity = sendBugNotification.mock.calls[0][3] as string;
    expect(severity).toBe("P1");
  });

  it("fails when input_path missing", async () => {
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      project_id: "proj-1",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(3, "failed", "CI log content is required");
  });

  it("fails when workspace has no plane_project_id", async () => {
    getWorkspace.mockReturnValueOnce({
      id: 1,
      name: "NoPlane",
      slug: "noplane",
      plane_project_id: null,
      plane_workspace_slug: "plane-ws",
      dify_dataset_id: null,
      dify_rag_api_key: null,
      wiki_path_prefix: null,
      git_repos: "{}",
      feishu_chat_id: null,
      created_at: "",
      updated_at: "",
    });
    await triggerWorkflow({
      workspace_id: 1,
      workflow_type: "bug_analysis",
      trigger_source: "cicd_webhook",
      input_path: "CI log",
    });
    await tick();

    expect(updateWorkflowStatus).toHaveBeenCalledWith(
      3,
      "failed",
      "workspace 1 missing plane_project_id",
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
      trigger_source: "api",
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
      workspace_id: 1,
      workflow_type: "code_gen",
      trigger_source: "api",
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
      workspace_id: 1,
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
      workspace_id: 1,
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
      workspace_id: 1,
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
      workspace_id: 1,
      workflow_type: "prd_to_tech",
      trigger_source: "webhook",
      input_path: "prd/feature-x.md",
    });
    await tick();

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
