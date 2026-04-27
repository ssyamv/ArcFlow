import {
  createWorkflowExecution,
  createWorkflowLink,
  getWorkflowExecution,
  updateWorkflowStatus,
  getWorkspace,
  createWorkflowSubtask,
} from "../db/queries";
import type { WorkflowType, TriggerSource, Workspace } from "../types";
import { ensureRepo, readFile, registerRepoUrl } from "./git";
import { dispatchToNanoclaw } from "./nanoclaw-dispatch";
import { sendNotification } from "./feishu";

interface TriggerParams {
  workspace_id: number;
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id?: string;
  input_path?: string;
  target_repos?: string[];
  figma_url?: string;
  chat_id?: string;
  source_execution_id?: number;
  source_stage?: string;
  correlation_id?: string;
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
  const sourceCorrelationId = params.source_execution_id
    ? getWorkflowExecution(params.source_execution_id)?.correlation_id
    : null;
  const correlationId = params.correlation_id ?? sourceCorrelationId ?? `wf-${crypto.randomUUID()}`;
  const executionId = createWorkflowExecution({
    workflow_type: params.workflow_type,
    trigger_source: params.trigger_source,
    plane_issue_id: params.plane_issue_id,
    input_path: params.input_path,
    correlation_id: correlationId,
  });

  if (params.source_execution_id) {
    createWorkflowLink({
      source_execution_id: params.source_execution_id,
      target_execution_id: executionId,
      link_type: "derived_from",
      metadata: {
        ...(params.source_stage ? { source_stage: params.source_stage } : {}),
        correlation_id: correlationId,
      },
    });
  }

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
        return;
      default:
        // prd_to_tech, tech_to_openapi, bug_analysis are now handled by NanoClaw skills.
        throw new Error(`workflow_type ${params.workflow_type} is no longer supported by Gateway`);
    }
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
  executionId: number,
  params: TriggerParams,
  ws: Workspace,
): Promise<void> {
  const correlationId =
    params.correlation_id ?? getWorkflowExecution(executionId)?.correlation_id ?? null;
  const targets = params.target_repos ?? ["backend"];
  const repoMap = safeParseRepos(ws.git_repos);
  const invalidTargets = targets.filter((target) => !repoMap[target]);
  if (invalidTargets.length > 0) {
    throw new Error(`invalid target repo: ${invalidTargets.join(", ")}`);
  }
  const docsRepo = wsRepoName(ws.id, "docs");

  let taskContext = "";
  if (params.input_path) {
    await ensureRepo(docsRepo);
    taskContext = await readFile(docsRepo, params.input_path);
  }

  for (const target of targets) {
    createWorkflowSubtask({
      execution_id: executionId,
      stage: "dispatch",
      target,
      provider: "nanoclaw",
      status: "pending",
      repo_name: target,
      correlation_id: correlationId,
    });

    const dispatchResult = await dispatchToNanoclaw({
      workspaceId: String(ws.id),
      skill: "arcflow-code-gen",
      planeIssueId: params.plane_issue_id,
      sourceExecutionId: executionId,
      sourceStage: "dispatch",
      correlationId,
      input: {
        execution_id: executionId,
        correlation_id: correlationId,
        target,
        workspace_id: ws.id,
        plane_issue_id: params.plane_issue_id,
        input_path: params.input_path,
        figma_url: params.figma_url,
        task_context: taskContext,
      },
    });

    if (!dispatchResult.dispatched) {
      throw new Error(dispatchResult.error ?? "NanoClaw dispatch did not start");
    }
    if (
      dispatchResult.nanoclawStatus !== undefined &&
      (dispatchResult.nanoclawStatus < 200 || dispatchResult.nanoclawStatus >= 300)
    ) {
      throw new Error(`NanoClaw dispatch returned status ${dispatchResult.nanoclawStatus}`);
    }
  }
}
