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
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ExecutionListResponse {
  data: Array<{
    id: number;
    workflow_type: string;
    trigger_source: string;
    plane_issue_id: string | null;
    status: string;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  total: number;
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

export function triggerWorkflow(params: {
  workflow_type: string;
  plane_issue_id: string;
  input_path?: string;
}): Promise<TriggerResponse> {
  return request<TriggerResponse>("/api/workflow/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function fetchVersion(): Promise<VersionResponse> {
  return request<VersionResponse>("/version");
}
