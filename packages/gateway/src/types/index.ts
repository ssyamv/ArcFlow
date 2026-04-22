// Webhook 来源
export type WebhookSource = "plane" | "git" | "cicd" | "feishu" | "ibuild";
export type WebhookJobStatus = "pending" | "running" | "success" | "failed" | "dead";

// 工作流类型
export type WorkflowType = "prd_to_tech" | "tech_to_openapi" | "bug_analysis" | "code_gen";

// 工作流触发来源
export type TriggerSource = "plane_webhook" | "cicd_webhook" | "ibuild_webhook" | "manual";

// 工作流执行状态
export type WorkflowStatus = "pending" | "running" | "success" | "failed";

// Dispatch 状态
export type WorkflowDispatchStatus = "pending" | "running" | "success" | "failed" | "timeout";

// Bug 修复状态
export type BugFixStatus = "pending" | "fixing" | "fixed" | "escalated";
export type BugAnalysisNextAction = "auto_fix_candidate" | "manual_handoff";
export type BugAnalysisConfidence = "high" | "medium" | "low";

// 工作流执行记录
export interface WorkflowExecution {
  id: number;
  workflow_type: WorkflowType;
  trigger_source: TriggerSource;
  plane_issue_id: string | null;
  input_path: string | null;
  output_path: string | null;
  status: WorkflowStatus;
  error_message: string | null;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowSubtask {
  id: number;
  execution_id: number;
  stage: string;
  target: string;
  provider: string;
  status: WorkflowStatus;
  input_ref: string | null;
  output_ref: string | null;
  external_run_id: string | null;
  branch_name: string | null;
  repo_name: string | null;
  log_url: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowLink {
  id: number;
  source_execution_id: number;
  target_execution_id: number;
  link_type: string;
  metadata: string;
  created_at: string;
}

export interface WorkflowDispatch {
  id: string;
  workspace_id: string;
  skill: string;
  input_json: string;
  status: WorkflowDispatchStatus;
  created_at: number;
  completed_at: number | null;
  plane_issue_id: string | null;
  source_execution_id: number | null;
  source_stage: string | null;
  started_at: number | null;
  last_callback_at: number | null;
  error_message: string | null;
  result_summary: string | null;
  callback_replay_count: number;
  timeout_at: number | null;
  diagnostic_flags: string[];
}

export interface WorkflowExecutionSummary {
  total_targets: number;
  completed_targets: number;
  latest_stage: string | null;
}

export interface WorkflowBugReportSummary {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: BugAnalysisConfidence;
  next_action: BugAnalysisNextAction;
}

export interface WorkflowCurrentStageSummary {
  label: string;
  stage: string | null;
  target: string | null;
  status: WorkflowStatus | WorkflowDispatchStatus;
}

export interface WorkflowExecutionListItem extends WorkflowExecution {
  summary: WorkflowExecutionSummary | null;
}

export interface WorkflowExecutionDetail extends WorkflowExecution {
  summary: WorkflowExecutionSummary | null;
  bug_report_summary: WorkflowBugReportSummary | null;
  current_stage_summary: WorkflowCurrentStageSummary | null;
  dispatches: WorkflowDispatch[];
  subtasks: WorkflowSubtask[];
  links: WorkflowLink[];
}

export interface WebhookJob {
  id: number;
  source: WebhookSource;
  event_type: string;
  action: string;
  status: WebhookJobStatus;
  attempt_count: number;
  max_attempts: number;
  next_run_at: number | null;
  last_error: string | null;
  payload_json: string;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

// Bug 修复重试记录
export interface BugFixRetry {
  id: number;
  plane_issue_id: string;
  bug_issue_id: string | null;
  retry_count: number;
  last_attempt_at: string | null;
  status: BugFixStatus;
  created_at: string;
}

// Webhook 事件记录
export interface WebhookEvent {
  event_id: string;
  source: WebhookSource;
  received_at: string;
}

// API 请求/响应类型
export interface TriggerWorkflowRequest {
  workspace_id: number;
  workflow_type: WorkflowType;
  plane_issue_id?: string;
  source_execution_id?: number;
  source_stage?: string;
  params?: {
    input_path?: string;
    target_repos?: string[];
    figma_url?: string;
    chat_id?: string;
  };
}

export interface TriggerWorkflowResponse {
  execution_id: number;
  status: WorkflowStatus;
  message: string;
}

export interface ExecutionListResponse {
  data: WorkflowExecutionListItem[];
  total: number;
}

export interface IBuildWebhookPayload {
  status: string;
  buildId: string;
  projectId: string;
  appId: string;
  gitBranch: string;
  commitId: string;
  projectKey: string;
  appKey: string;
  builder: string;
  startTime: string;
  appVersion?: string;
  longCommitId?: string;
  artifactoryRepo?: string;
  projectVersion?: string;
}

export interface IBuildModule {
  moduleId: string;
  modulekey: string;
  status: string;
}

export interface IBuildDetail {
  uuid: string;
  buildSid: string;
  branch: string;
  commitNum: string;
  executor: string;
  executorName: string;
  executeTime: string;
  duration: string;
  status: string;
  modules: IBuildModule[] | null;
  logUrl?: string;
}

// 用户
export interface User {
  id: number;
  feishu_user_id: string;
  feishu_union_id: string | null;
  name: string;
  avatar_url: string | null;
  email: string | null;
  role: "admin" | "member";
  created_at: string;
  last_login_at: string | null;
}

// 对话
export interface Conversation {
  id: number;
  user_id: number;
  workspace_id: number | null;
  title: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

// 消息
export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// 工作空间
export interface Workspace {
  id: number;
  name: string;
  slug: string;
  plane_project_id: string | null;
  plane_workspace_slug: string | null;
  wiki_path_prefix: string | null;
  git_repos: string;
  feishu_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: number;
  workspace_id: number;
  user_id: number;
  role: "admin" | "member";
  created_at: string;
}

export interface ArcflowIssueItem {
  id: string;
  name: string;
}

export interface ArcflowIssueListResponse {
  items: ArcflowIssueItem[];
}

export interface CreateRequirementDraftRequest {
  title: string;
  content: string;
  dryRun?: boolean;
}

export interface CreateRequirementDraftResponse {
  mode: "dry_run" | "created";
  path: string;
  preview: string;
}
