const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("arcflow_token");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const wsId = localStorage.getItem("arcflow_workspace_id");
  if (wsId) headers["X-Workspace-Id"] = wsId;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("arcflow_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export interface SearchResult {
  path: string;
  name: string;
  matches: string[];
}

export function fetchTree(): Promise<{ data: TreeNode[] }> {
  return request("/api/docs/tree");
}

export function fetchFile(path: string): Promise<{ content: string; path: string }> {
  return request(`/api/docs/file?path=${encodeURIComponent(path)}`);
}

export function createFile(path: string, content: string): Promise<{ ok: boolean; path: string }> {
  return request("/api/docs/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export function updateFile(path: string, content: string): Promise<{ ok: boolean; path: string }> {
  return request("/api/docs/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export function deleteFile(path: string): Promise<{ ok: boolean }> {
  return request(`/api/docs/file?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

export function createFolder(path: string): Promise<{ ok: boolean; path: string }> {
  return request("/api/docs/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function renameDoc(oldPath: string, newPath: string): Promise<{ ok: boolean }> {
  return request("/api/docs/rename", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPath, newPath }),
  });
}

export function searchDocs(q: string): Promise<{ data: SearchResult[] }> {
  return request(`/api/docs/search?q=${encodeURIComponent(q)}`);
}
