const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

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

export interface WorkspaceDetail extends Workspace {
  members: Array<{ user_id: number; name: string; role: string }>;
  user_role: string;
}

export async function fetchWorkspaces(): Promise<{ data: Workspace[] }> {
  const res = await fetch(`${API_BASE}/api/workspaces`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load workspaces");
  return res.json();
}

export async function fetchWorkspaceDetail(id: number): Promise<WorkspaceDetail> {
  const res = await fetch(`${API_BASE}/api/workspaces/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to load workspace");
  return res.json();
}

export async function updateWorkspaceSettings(
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await fetch(`${API_BASE}/api/workspaces/${id}/settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const res = await fetch(`${API_BASE}/api/workspaces`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create workspace");
  return res.json();
}

export async function syncPlaneProjects(): Promise<{ created: number; skipped: number }> {
  const res = await fetch(`${API_BASE}/api/workspaces/sync-plane`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Sync failed");
  return res.json();
}
