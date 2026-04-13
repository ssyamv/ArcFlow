const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  const wsId = localStorage.getItem("arcflow_workspace_id");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (wsId) h["X-Workspace-Id"] = wsId;
  return h;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string;
}

export interface IssueSummary {
  total: number;
  started: number;
  backlog: number;
  completed: number;
  cancelled: number;
}

export interface PlaneCycle {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_issues: number;
  completed_issues: number;
}

export async function fetchPlaneProjects(slug: string): Promise<PlaneProject[]> {
  const res = await fetch(`${API_BASE}/api/plane/projects?slug=${encodeURIComponent(slug)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch Plane projects");
  const body = await res.json();
  return body.data;
}

export async function fetchIssueSummary(): Promise<IssueSummary> {
  const res = await fetch(`${API_BASE}/api/plane/issues/summary`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch issue summary");
  return res.json();
}

export async function fetchActiveCycles(): Promise<PlaneCycle[]> {
  const res = await fetch(`${API_BASE}/api/plane/cycles/active`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch active cycles");
  const body = await res.json();
  return body.data;
}
