// Webhook 来源
export type WebhookSource = "plane" | "git" | "cicd" | "feishu" | "ibuild";

// 工作流类型
export type WorkflowType = "prd_to_tech" | "tech_to_openapi" | "bug_analysis" | "code_gen";

// 工作流触发来源
export type TriggerSource = "plane_webhook" | "cicd_webhook" | "ibuild_webhook" | "manual";

// 工作流执行状态
export type WorkflowStatus = "pending" | "running" | "success" | "failed";

// Bug 修复状态
export type BugFixStatus = "pending" | "fixing" | "fixed" | "escalated";

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
  workflow_type: WorkflowType;
  plane_issue_id: string;
  params?: {
    input_path?: string;
    target_repos?: string[];
    figma_url?: string;
    project_id?: string;
    chat_id?: string;
  };
}

export interface TriggerWorkflowResponse {
  execution_id: number;
  status: WorkflowStatus;
  message: string;
}

export interface ExecutionListResponse {
  data: WorkflowExecution[];
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
  dify_conversation_id: string | null;
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
  dify_dataset_id: string | null;
  dify_rag_api_key: string | null;
  wiki_path_prefix: string | null;
  git_repos: string;
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
