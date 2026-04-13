import {
  createWorkflowExecution,
  updateWorkflowStatus,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
  getWorkspace,
} from "../db/queries";
import type { WorkflowType, TriggerSource, Workspace } from "../types";
import { getConfig } from "../config";
import { ensureRepo, readFile, writeAndPush, createBranchAndPush, registerRepoUrl } from "./git";
import { generateTechDoc, generateOpenApi, analyzeBug } from "./dify";
import { createBugIssue } from "./plane";
import { sendTechReviewCard, sendNotification, sendBugNotification } from "./feishu";
import { runClaudeCode } from "./claude-code";
import { join } from "path";

interface TriggerParams {
  workspace_id: number;
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
  target_repos?: string[];
  figma_url?: string;
  chat_id?: string;
}

/** 加载 workspace 并注册其 git 仓库到动态注册表 */
function loadWorkspace(workspaceId: number): Workspace {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error(`workspace ${workspaceId} not found`);
  const repos = safeParseRepos(ws.git_repos);
  for (const [name, url] of Object.entries(repos)) {
    if (url) registerRepoUrl(wsRepoName(ws.id, name), url);
  }
  return ws;
}

function safeParseRepos(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function wsRepoName(workspaceId: number, repo: string): string {
  return `ws-${workspaceId}-${repo}`;
}

function requirePlaneContext(ws: Workspace): {
  planeSlug: string;
  planeProjectId: string;
} {
  if (!ws.plane_workspace_slug) throw new Error(`workspace ${ws.id} missing plane_workspace_slug`);
  if (!ws.plane_project_id) throw new Error(`workspace ${ws.id} missing plane_project_id`);
  return { planeSlug: ws.plane_workspace_slug, planeProjectId: ws.plane_project_id };
}

export async function triggerWorkflow(params: TriggerParams): Promise<number> {
  const executionId = createWorkflowExecution({
    workflow_type: params.workflow_type,
    trigger_source: params.trigger_source,
    plane_issue_id: params.plane_issue_id,
    input_path: params.input_path,
  });

  updateWorkflowStatus(executionId, "running");

  // Fire-and-forget: run workflow asynchronously
  executeWorkflow(executionId, params).catch((error) => {
    console.error(`Workflow ${executionId} failed:`, error);
  });

  return executionId;
}

async function executeWorkflow(executionId: number, params: TriggerParams): Promise<void> {
  try {
    if (!params.workspace_id) throw new Error("workspace_id is required");
    const ws = loadWorkspace(params.workspace_id);

    switch (params.workflow_type) {
      case "prd_to_tech":
        await flowPrdToTech(executionId, params, ws);
        break;
      case "tech_to_openapi":
        await flowTechToOpenApi(executionId, params, ws);
        break;
      case "bug_analysis":
        await flowBugAnalysis(executionId, params, ws);
        break;
      case "code_gen":
        await flowCodeGen(executionId, params, ws);
        break;
    }
    updateWorkflowStatus(executionId, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateWorkflowStatus(executionId, "failed", message);

    // Notify on failure (non-blocking)
    if (params.chat_id) {
      sendNotification(
        params.chat_id,
        "⚠️ 工作流失败",
        `工作流 ${params.workflow_type} 执行失败：${message}`,
      ).catch(() => {});
    }
  }
}

// Flow A: PRD Approved → Tech Doc + OpenAPI
async function flowPrdToTech(
  _executionId: number,
  params: TriggerParams,
  ws: Workspace,
): Promise<void> {
  if (!params.input_path) throw new Error("input_path is required for prd_to_tech");

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const featureName = params.input_path.split("/").pop()?.replace(".md", "") ?? "unknown";
  const docsRepo = wsRepoName(ws.id, "docs");

  await ensureRepo(docsRepo);
  const prdContent = await readFile(docsRepo, params.input_path);

  const techDoc = await generateTechDoc(prdContent);
  const techDocPath = `tech-design/${monthDir}/${featureName}.md`;
  await writeAndPush(docsRepo, techDocPath, techDoc, `docs: AI 生成技术设计文档 - ${featureName}`);

  const openApi = await generateOpenApi(techDoc);
  const openApiPath = `api/${monthDir}/${featureName}.yaml`;
  await writeAndPush(docsRepo, openApiPath, openApi, `docs: AI 生成 OpenAPI - ${featureName}`);

  if (params.chat_id) {
    const { planeSlug, planeProjectId } = requirePlaneContext(ws);
    sendTechReviewCard({
      chatId: params.chat_id,
      featureName,
      prdPath: params.input_path,
      techDocPath,
      openApiPath,
      issueId: params.plane_issue_id ?? "",
      workspaceSlug: ws.slug,
      planeWorkspaceSlug: planeSlug,
      planeProjectId,
    }).catch(() => {});
  }
}

async function flowTechToOpenApi(
  _executionId: number,
  params: TriggerParams,
  ws: Workspace,
): Promise<void> {
  if (!params.input_path) throw new Error("input_path is required for tech_to_openapi");

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const featureName = params.input_path.split("/").pop()?.replace(".md", "") ?? "unknown";
  const docsRepo = wsRepoName(ws.id, "docs");

  await ensureRepo(docsRepo);
  const techDocContent = await readFile(docsRepo, params.input_path);

  const openApi = await generateOpenApi(techDocContent);
  const openApiPath = `api/${monthDir}/${featureName}.yaml`;
  await writeAndPush(docsRepo, openApiPath, openApi, `docs: AI 生成 OpenAPI - ${featureName}`);
}

async function flowBugAnalysis(
  _executionId: number,
  params: TriggerParams,
  ws: Workspace,
): Promise<void> {
  if (!params.input_path) throw new Error("CI log content is required");
  const { planeSlug, planeProjectId } = requirePlaneContext(ws);

  const sourceIssueId = params.plane_issue_id ?? "unknown";

  const existingRetry = getBugFixRetry(sourceIssueId);

  if (existingRetry && existingRetry.retry_count >= 2) {
    updateBugFixStatus(sourceIssueId, "escalated");
    if (params.chat_id) {
      sendBugNotification(
        params.chat_id,
        existingRetry.bug_issue_id ?? sourceIssueId,
        `Issue ${sourceIssueId} 自动修复已达上限（2 次），请人工介入`,
        "P0",
      ).catch(() => {});
    }
    return;
  }

  const bugReport = await analyzeBug(params.input_path, sourceIssueId);
  const severity = parseSeverity(bugReport);

  let bugIssueId = existingRetry?.bug_issue_id;
  if (!existingRetry) {
    const bugIssue = await createBugIssue(planeSlug, planeProjectId, {
      name: `[Bug] CI 失败 - ${sourceIssueId}`,
      description_html: bugReport,
      priority: severity === "P0" ? "urgent" : "high",
      parent_issue_id: params.plane_issue_id,
    });
    bugIssueId = bugIssue.id;
    createBugFixRetry(sourceIssueId, bugIssue.id);
  }

  if (params.chat_id) {
    const retryLabel = existingRetry ? `（第 ${existingRetry.retry_count + 1} 次重试）` : "";
    sendBugNotification(
      params.chat_id,
      bugIssueId ?? sourceIssueId,
      `${bugReport}\n\n---\n🔧 正在尝试自动修复${retryLabel}`,
      severity,
    ).catch(() => {});
  }

  incrementBugFixRetry(sourceIssueId);

  const targetRepoBase = params.target_repos?.[0] ?? "backend";
  const targetRepo = wsRepoName(ws.id, targetRepoBase);
  await ensureRepo(targetRepo);
  const config = getConfig();
  const repoDir = join(config.gitWorkDir, targetRepo);

  const result = await runClaudeCode(repoDir, `根据以下 Bug 分析报告修复代码：\n\n${bugReport}`);

  if (result.success) {
    const branchName = `fix/bug-${bugIssueId ?? sourceIssueId}`;
    await createBranchAndPush(targetRepo, branchName, `fix: auto-fix bug ${sourceIssueId}`);
    updateBugFixStatus(sourceIssueId, "fixed");

    if (params.chat_id) {
      sendNotification(
        params.chat_id,
        "✅ Bug 自动修复完成",
        `Bug ${bugIssueId ?? sourceIssueId} 已自动修复，MR 已创建，分支 ${branchName}`,
      ).catch(() => {});
    }
  } else {
    updateBugFixStatus(sourceIssueId, "pending");
    if (params.chat_id) {
      sendNotification(
        params.chat_id,
        "⚠️ Bug 自动修复失败",
        `Bug ${bugIssueId ?? sourceIssueId} 修复失败：${result.error}`,
      ).catch(() => {});
    }
  }
}

/** 从 Dify Bug 报告中解析严重级别 */
function parseSeverity(bugReport: string): string {
  const match =
    bugReport.match(/\*{0,2}严重级别[：:]\*{0,2}\s*(P[0-2])/i) ??
    bugReport.match(/\*{0,2}Severity[：:]\*{0,2}\s*(P[0-2])/i);
  return match?.[1]?.toUpperCase() ?? "P1";
}

async function flowCodeGen(
  _executionId: number,
  params: TriggerParams,
  ws: Workspace,
): Promise<void> {
  const repoBases = params.target_repos ?? ["backend"];
  const config = getConfig();
  const docsRepo = wsRepoName(ws.id, "docs");

  for (const repoBase of repoBases) {
    const repoName = wsRepoName(ws.id, repoBase);
    await ensureRepo(repoName);

    let taskContext = "";
    if (params.input_path) {
      await ensureRepo(docsRepo);
      const techDoc = await readFile(docsRepo, params.input_path);
      taskContext += `## 技术设计文档\n\n${techDoc}\n\n`;
    }

    const repoDir = join(config.gitWorkDir, repoName);
    const taskDescription = `请根据以下上下文生成代码：\n\n${taskContext}`;

    const result = await runClaudeCode(repoDir, taskDescription, {
      figmaUrl: params.figma_url,
    });

    if (result.success) {
      const branchName = `feature/${params.plane_issue_id ?? "unknown"}-${repoBase}`;
      await createBranchAndPush(
        repoName,
        branchName,
        `feat: AI 代码生成 - ${params.plane_issue_id}`,
      );

      if (params.chat_id) {
        sendNotification(
          params.chat_id,
          "✅ 代码生成完成",
          `${repoBase} 代码已生成，分支 ${branchName} 已推送`,
        ).catch(() => {});
      }
    } else {
      throw new Error(`Code gen failed for ${repoBase}: ${result.error}`);
    }
  }
}
