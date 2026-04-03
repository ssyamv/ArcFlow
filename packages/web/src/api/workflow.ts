const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function fetchExecutions(filters?: {
  workflow_type?: string;
  status?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.workflow_type) params.set("workflow_type", filters.workflow_type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const res = await fetch(`${API_BASE}/api/workflow/executions?${params}`);
  return res.json();
}

export async function triggerWorkflow(params: {
  workflow_type: string;
  plane_issue_id: string;
  input_path?: string;
}) {
  const res = await fetch(`${API_BASE}/api/workflow/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}
