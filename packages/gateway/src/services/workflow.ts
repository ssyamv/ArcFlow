import { createWorkflowExecution, updateWorkflowStatus, getWorkspace } from "../db/queries";
import type { WorkflowType, TriggerSource, Workspace } from "../types";
import { getConfig } from "../config";
import { ensureRepo, readFile, createBranchAndPush, registerRepoUrl } from "./git";
import { sendNotification } from "./feishu";
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
      case "code_gen":
        await flowCodeGen(executionId, params, ws);
        break;
      default:
        // prd_to_tech, tech_to_openapi, bug_analysis are now handled by NanoClaw skills.
        throw new Error(`workflow_type ${params.workflow_type} is no longer supported by Gateway`);
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
