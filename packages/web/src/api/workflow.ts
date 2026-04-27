const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("arcflow_token");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const wsId = localStorage.getItem("arcflow_workspace_id");
  if (wsId) headers["X-Workspace-Id"] = wsId;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("arcflow_token");
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ExecutionListResponse {
  data: ExecutionListItem[];
  total: number;
}

export interface WorkflowSummary {
  total_targets: number;
  completed_targets: number;
  latest_stage: string | null;
}

export interface WorkflowSubtask {
  id: number;
  execution_id?: number;
  target: string;
  stage: string;
  provider: string;
  status: string;
  input_ref?: string | null;
  output_ref?: string | null;
  external_run_id?: string | null;
  branch_name?: string | null;
  repo_name?: string | null;
  log_url?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
  correlation_id?: string | null;
}

export interface WorkflowLink {
  id: number;
  source_execution_id: number;
  target_execution_id: number;
  link_type: string;
  metadata?: string;
  created_at?: string;
}

export interface CurrentStageSummary {
  label: string;
  target: string | null;
  stage: string | null;
  status: string | null;
}

export interface WorkflowDiagnostic {
  kind: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  target: string | null;
  stage: string | null;
  dispatch_id: string | null;
  subtask_id: number | null;
  timestamp: number | string | null;
}

export interface WorkflowBugReportSummary {
  summary: string;
  root_cause: string;
  suggested_fix: string;
  confidence: "high" | "medium" | "low";
  next_action: "auto_fix_candidate" | "manual_handoff";
}

export interface WorkflowDispatch {
  id: string;
  workspace_id: string;
  skill: string;
  input_json: string;
  status: string;
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
  correlation_id?: string | null;
  diagnostic_flags: string[];
}

export interface ExecutionListItem {
  id: number;
  workflow_type: string;
  trigger_source: string;
  plane_issue_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  correlation_id?: string | null;
  summary?: WorkflowSummary | null;
}

export interface TriggerResponse {
  execution_id: number;
  status: string;
  message: string;
}

export interface HealthResponse {
  status: string;
}

export interface VersionResponse {
  version: string;
}

export interface WebhookJob {
  id: number;
  source: string;
  event_type: string;
  action: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_run_at: number | null;
  last_error: string | null;
  payload: unknown;
  result: unknown;
  created_at: number;
  updated_at: number;
  correlation_id?: string | null;
}

export interface WebhookJobListResponse {
  data: WebhookJob[];
  total: number;
}

export interface ExecutionDetail {
  id: number;
  workflow_type: string;
  trigger_source: string;
  plane_issue_id: string | null;
  input_path: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  correlation_id: string | null;
  summary?: WorkflowSummary | null;
  bug_report_summary?: WorkflowBugReportSummary | null;
  current_stage_summary?: CurrentStageSummary | null;
  workflow_diagnostics?: WorkflowDiagnostic[];
  subtasks?: WorkflowSubtask[];
  dispatches?: WorkflowDispatch[];
  links?: WorkflowLink[];
}

export function fetchExecution(id: number): Promise<ExecutionDetail> {
  return request<ExecutionDetail>(`/api/workflow/executions/${id}`);
}

export function fetchExecutions(filters?: {
  workflow_type?: string;
  status?: string;
  limit?: number;
}): Promise<ExecutionListResponse> {
  const params = new URLSearchParams();
  if (filters?.workflow_type) params.set("workflow_type", filters.workflow_type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));
  return request<ExecutionListResponse>(`/api/workflow/executions?${params}`);
}

export function fetchWebhookJobs(filters?: {
  source?: string;
  action?: string;
  status?: string;
  correlation_id?: string;
  limit?: number;
}): Promise<WebhookJobListResponse> {
  const params = new URLSearchParams();
  if (filters?.source) params.set("source", filters.source);
  if (filters?.action) params.set("action", filters.action);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.correlation_id) params.set("correlation_id", filters.correlation_id);
  if (filters?.limit) params.set("limit", String(filters.limit));
  return request<WebhookJobListResponse>(`/api/webhook/jobs?${params}`);
}

export function fetchWebhookJob(id: number): Promise<WebhookJob> {
  return request<WebhookJob>(`/api/webhook/jobs/${id}`);
}

export function triggerWorkflow(params: {
  workflow_type: string;
  plane_issue_id: string;
  input_path?: string;
  target_repos?: string[];
  figma_url?: string;
}): Promise<TriggerResponse> {
  const { workflow_type, plane_issue_id, ...rest } = params;
  return request<TriggerResponse>("/api/workflow/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflow_type,
      plane_issue_id,
      params: {
        input_path: rest.input_path,
        target_repos: rest.target_repos,
        figma_url: rest.figma_url,
      },
    }),
  });
}

export function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function fetchVersion(): Promise<VersionResponse> {
  return request<VersionResponse>("/version");
}
