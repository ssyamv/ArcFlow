import {
  createWorkflowExecution,
  updateWorkflowStatus,
  createBugFixRetry,
  getBugFixRetry,
  incrementBugFixRetry,
  updateBugFixStatus,
} from "../db/queries";
import type { WorkflowType, TriggerSource } from "../types";
import { getConfig } from "../config";
import { ensureRepo, readFile, writeAndPush, createBranchAndPush } from "./git";
import { generateTechDoc, generateOpenApi, analyzeBug } from "./dify";
import { createBugIssue } from "./plane";
import { sendTechReviewCard, sendNotification, sendBugNotification } from "./feishu";
import { triggerSync } from "./wikijs";
import { runClaudeCode } from "./claude-code";
import { join } from "path";

interface TriggerParams {
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
  target_repos?: string[];
  figma_url?: string;
  project_id?: string;
  chat_id?: string;
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
    switch (params.workflow_type) {
      case "prd_to_tech":
        await flowPrdToTech(executionId, params);
        break;
      case "tech_to_openapi":
        await flowTechToOpenApi(executionId, params);
        break;
      case "bug_analysis":
        await flowBugAnalysis(executionId, params);
        break;
      case "code_gen":
        await flowCodeGen(executionId, params);
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
async function flowPrdToTech(executionId: number, params: TriggerParams): Promise<void> {
  if (!params.input_path) throw new Error("input_path is required for prd_to_tech");

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const featureName = params.input_path.split("/").pop()?.replace(".md", "") ?? "unknown";

  // 1. Pull docs repo and read PRD
  await ensureRepo("docs");
  const prdContent = await readFile("docs", params.input_path);

  // 2. Call Dify workflow 1: PRD → Tech Doc
  const techDoc = await generateTechDoc(prdContent);
  const techDocPath = `tech-design/${monthDir}/${featureName}.md`;
  await writeAndPush("docs", techDocPath, techDoc, `docs: AI 生成技术设计文档 - ${featureName}`);

  // 3. Trigger Wiki.js sync (non-blocking)
  triggerSync().catch(() => {});

  // 4. Call Dify workflow 2: Tech Doc → OpenAPI
  const openApi = await generateOpenApi(techDoc);
  const openApiPath = `api/${monthDir}/${featureName}.yaml`;
  await writeAndPush("docs", openApiPath, openApi, `docs: AI 生成 OpenAPI - ${featureName}`);

  // 5. Trigger Wiki.js sync again (non-blocking)
  triggerSync().catch(() => {});

  // 6. Send Feishu review card (non-blocking)
  if (params.chat_id) {
    sendTechReviewCard({
      chatId: params.chat_id,
      featureName,
      prdLink: params.input_path,
      techDocLink: techDocPath,
      openApiLink: openApiPath,
      issueId: params.plane_issue_id ?? "",
      docPath: techDocPath,
    }).catch(() => {});
  }
}

// Flow A (partial): Tech Doc → OpenAPI only
async function flowTechToOpenApi(_executionId: number, params: TriggerParams): Promise<void> {
  if (!params.input_path) throw new Error("input_path is required for tech_to_openapi");

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const featureName = params.input_path.split("/").pop()?.replace(".md", "") ?? "unknown";

  await ensureRepo("docs");
  const techDocContent = await readFile("docs", params.input_path);

  const openApi = await generateOpenApi(techDocContent);
  const openApiPath = `api/${monthDir}/${featureName}.yaml`;
  await writeAndPush("docs", openApiPath, openApi, `docs: AI 生成 OpenAPI - ${featureName}`);

  triggerSync().catch(() => {});
}

// Flow D: CI/CD Failure → Bug Analysis + Auto Fix
async function flowBugAnalysis(_executionId: number, params: TriggerParams): Promise<void> {
  if (!params.input_path) throw new Error("CI log content is required");
  if (!params.project_id) throw new Error("project_id is required");

  const sourceIssueId = params.plane_issue_id ?? "unknown";

  // 1. Check if this is a retry for an existing bug
  const existingRetry = getBugFixRetry(sourceIssueId);

  if (existingRetry && existingRetry.retry_count >= 2) {
    // Already exhausted retries → escalate
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

  // 2. Call Dify workflow 3: CI Log → Bug Report
  const bugReport = await analyzeBug(params.input_path, sourceIssueId);
  const severity = parseSeverity(bugReport);

  // 3. Create Bug Issue in Plane (only on first failure)
  let bugIssueId = existingRetry?.bug_issue_id;
  if (!existingRetry) {
    const bugIssue = await createBugIssue(params.project_id, {
      name: `[Bug] CI 失败 - ${sourceIssueId}`,
      description_html: bugReport,
      priority: severity === "P0" ? "urgent" : "high",
      parent_issue_id: params.plane_issue_id,
    });
    bugIssueId = bugIssue.id;
    createBugFixRetry(sourceIssueId, bugIssue.id);
  }

  // 4. Send bug notification
  if (params.chat_id) {
    const retryLabel = existingRetry ? `（第 ${existingRetry.retry_count + 1} 次重试）` : "";
    sendBugNotification(
      params.chat_id,
      bugIssueId ?? sourceIssueId,
      `${bugReport}\n\n---\n🔧 正在尝试自动修复${retryLabel}`,
      severity,
    ).catch(() => {});
  }

  // 5. Increment retry count
  incrementBugFixRetry(sourceIssueId);

  // 6. Auto-fix with Claude Code
  const targetRepo = params.target_repos?.[0] ?? "backend";
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

// Flow C: Code Generation
async function flowCodeGen(_executionId: number, params: TriggerParams): Promise<void> {
  const repos = params.target_repos ?? ["backend"];
  const config = getConfig();

  for (const repoName of repos) {
    await ensureRepo(repoName);

    // Read tech design + OpenAPI if available
    let taskContext = "";
    if (params.input_path) {
      await ensureRepo("docs");
      const techDoc = await readFile("docs", params.input_path);
      taskContext += `## 技术设计文档\n\n${techDoc}\n\n`;
    }

    const repoDir = join(config.gitWorkDir, repoName);

    const taskDescription = `请根据以下上下文生成代码：\n\n${taskContext}`;

    const result = await runClaudeCode(repoDir, taskDescription, {
      figmaUrl: params.figma_url,
    });

    if (result.success) {
      const branchName = `feature/${params.plane_issue_id ?? "unknown"}-${repoName}`;
      await createBranchAndPush(
        repoName,
        branchName,
        `feat: AI 代码生成 - ${params.plane_issue_id}`,
      );

      if (params.chat_id) {
        sendNotification(
          params.chat_id,
          "✅ 代码生成完成",
          `${repoName} 代码已生成，分支 ${branchName} 已推送`,
        ).catch(() => {});
      }
    } else {
      throw new Error(`Code gen failed for ${repoName}: ${result.error}`);
    }
  }
}
