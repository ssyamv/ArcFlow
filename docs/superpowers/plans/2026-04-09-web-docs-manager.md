# Web 文档管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ArcFlow Web 前端新增文档管理页面，通过 Gateway 操作 docs Git 仓库，提供 Markdown 文件的浏览、WYSIWYG 编辑、新建、删除、重命名和搜索功能。

**Architecture:** Gateway 扩展 `git.ts` 新增目录树列举、删除、重命名、搜索能力，新增 `routes/docs.ts` 暴露 REST API。Web 前端新增 `Docs.vue` 页面（左侧文件树 + 右侧 Tiptap 编辑器），通过 Pinia store 管理状态。保存时直接 commit + push 到 docs Git 仓库，触发 Wiki.js sync。

**Tech Stack:** Bun + Hono (Gateway), Vue 3 + Tiptap + Turndown + Pinia (Web), simple-git, bun:test

---

## File Map

### Gateway（`packages/gateway/src/`）

| 文件 | 操作 | 职责 |
|------|------|------|
| `services/git.ts` | 修改 | 新增 `listTree`、`deleteFile`、`renameFile`、`searchFiles` |
| `services/git.test.ts` | 修改 | 新增函数的测试 |
| `routes/docs.ts` | 新建 | 文档 CRUD REST API 路由 |
| `routes/docs.test.ts` | 新建 | 路由集成测试 |
| `index.ts` | 修改 | 挂载 docs 路由 |

### Web 前端（`packages/web/src/`）

| 文件 | 操作 | 职责 |
|------|------|------|
| `api/docs.ts` | 新建 | 文档 API 调用封装 |
| `stores/docs.ts` | 新建 | Pinia store：文件树、当前文件、脏标记、搜索 |
| `pages/Docs.vue` | 新建 | 文档管理主页面（三栏布局） |
| `router/index.ts` | 修改 | 新增 `/docs` 路由 |
| `components/AppLayout.vue` | 修改 | 侧边栏导航加入「文档」入口 |

---

### Task 1: Gateway — 扩展 git.ts 增加 listTree

**Files:**

- Modify: `packages/gateway/src/services/git.ts`
- Modify: `packages/gateway/src/services/git.test.ts`

- [ ] **Step 1: 在 git.test.ts 中新增 listTree 的测试**

在 `git.test.ts` 文件末尾、最后一个 `describe` 块之后，追加：

```typescript
// --- Mock fs for listTree ---
const readdirSyncMock = mock(() => [] as unknown[]);
const statSyncMock = mock(() => ({ isDirectory: () => false }));

// 需要在顶部的 mock.module("fs", ...) 中追加 readdirSync 和 statSync

describe("listTree", () => {
  beforeEach(clearAllMocks);

  it("returns empty array for empty directory", async () => {
    existsSyncReturn = true;
    readdirSyncMock.mockReturnValue([]);
    const { listTree } = await import("./git");
    const tree = await listTree("docs");
    expect(tree).toEqual([]);
  });
});
```

注意：需要先修改顶部的 `mock.module("fs", ...)` 块，增加 `readdirSync` 和 `statSync` 的 mock。在 `mock.module("fs", ...)` 的返回对象中追加：

```typescript
readdirSync: readdirSyncMock,
statSync: statSyncMock,
```

并在 `clearAllMocks` 函数中追加：

```typescript
readdirSyncMock.mockClear();
statSyncMock.mockClear();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: FAIL — `listTree` is not exported from `./git`

- [ ] **Step 3: 在 git.ts 中实现 listTree**

在 `packages/gateway/src/services/git.ts` 文件末尾追加：

```typescript
import { readdirSync, statSync } from "fs";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export async function listTree(repoName: string): Promise<TreeNode[]> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);

  function walk(dir: string, relativePath: string): TreeNode[] {
    const entries = readdirSync(dir);
    const nodes: TreeNode[] = [];

    for (const entry of entries) {
      if (entry === ".git") continue;
      const fullPath = join(dir, entry);
      const relPath = relativePath ? `${relativePath}/${entry}` : entry;
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        nodes.push({
          name: entry,
          path: relPath,
          type: "directory",
          children: walk(fullPath, relPath),
        });
      } else {
        nodes.push({ name: entry, path: relPath, type: "file" });
      }
    }

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return walk(repoDir, "");
}
```

注意：`readdirSync` 和 `statSync` 需要添加到文件顶部已有的 `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"` 中。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/services/git.ts packages/gateway/src/services/git.test.ts
git commit -m "feat(gateway): git.ts 新增 listTree 递归目录树"
```

---

### Task 2: Gateway — 扩展 git.ts 增加 deleteFile、renameFile、searchFiles

**Files:**

- Modify: `packages/gateway/src/services/git.ts`
- Modify: `packages/gateway/src/services/git.test.ts`

- [ ] **Step 1: 在 git.test.ts 中新增 deleteFile 测试**

```typescript
describe("deleteFile", () => {
  beforeEach(clearAllMocks);

  it("deletes file, commits and pushes", async () => {
    const { deleteFile } = await import("./git");
    await deleteFile("docs", "prd/old.md", "docs: remove old prd");

    expect(gitMethods.add).toHaveBeenCalledWith("prd/old.md");
    expect(gitMethods.commit).toHaveBeenCalledWith("docs: remove old prd");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "main");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: FAIL — `deleteFile` is not exported

- [ ] **Step 3: 在 git.ts 中实现 deleteFile**

在文件顶部 import 中追加 `unlinkSync`。在文件末尾追加：

```typescript
export async function deleteFile(
  repoName: string,
  filePath: string,
  commitMessage: string,
): Promise<void> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);
  const fullPath = join(repoDir, filePath);

  unlinkSync(fullPath);

  const git = simpleGit(repoDir);
  const branch = await getDefaultBranch(git);
  await git.add(filePath);
  await git.commit(commitMessage);
  await git.push("origin", branch);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: PASS

- [ ] **Step 5: 在 git.test.ts 中新增 renameFile 测试**

```typescript
describe("renameFile", () => {
  beforeEach(clearAllMocks);

  it("renames file, commits and pushes", async () => {
    const { renameFile } = await import("./git");
    await renameFile("docs", "prd/old.md", "prd/new.md", "docs: rename prd");

    expect(gitMethods.add).toHaveBeenCalledWith("-A");
    expect(gitMethods.commit).toHaveBeenCalledWith("docs: rename prd");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "main");
  });
});
```

- [ ] **Step 6: 在 git.ts 中实现 renameFile**

在文件顶部 import 中追加 `renameSync`。在文件末尾追加：

```typescript
export async function renameFile(
  repoName: string,
  oldPath: string,
  newPath: string,
  commitMessage: string,
): Promise<void> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);

  const oldFull = join(repoDir, oldPath);
  const newFull = join(repoDir, newPath);
  mkdirSync(dirname(newFull), { recursive: true });
  renameSync(oldFull, newFull);

  const git = simpleGit(repoDir);
  const branch = await getDefaultBranch(git);
  await git.add("-A");
  await git.commit(commitMessage);
  await git.push("origin", branch);
}
```

- [ ] **Step 7: 运行测试确认 renameFile 通过**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: PASS

- [ ] **Step 8: 在 git.test.ts 中新增 searchFiles 测试**

```typescript
describe("searchFiles", () => {
  beforeEach(clearAllMocks);

  it("returns matching results", async () => {
    existsSyncReturn = true;
    readdirSyncMock.mockReturnValue(["readme.md"]);
    statSyncMock.mockReturnValue({ isDirectory: () => false });
    readFileSyncMock.mockReturnValue("line1\nfoo bar keyword baz\nline3");

    const { searchFiles } = await import("./git");
    const results = await searchFiles("docs", "keyword");

    expect(results.length).toBe(1);
    expect(results[0].path).toBe("readme.md");
    expect(results[0].matches[0]).toContain("keyword");
  });
});
```

- [ ] **Step 9: 在 git.ts 中实现 searchFiles**

在文件末尾追加：

```typescript
export interface SearchResult {
  path: string;
  name: string;
  matches: string[];
}

export async function searchFiles(repoName: string, keyword: string): Promise<SearchResult[]> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);
  const results: SearchResult[] = [];
  const lowerKeyword = keyword.toLowerCase();

  function walk(dir: string, relativePath: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const fullPath = join(dir, entry);
      const relPath = relativePath ? `${relativePath}/${entry}` : entry;
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const matchedLines = lines.filter((l) => l.toLowerCase().includes(lowerKeyword));
        if (matchedLines.length > 0 || entry.toLowerCase().includes(lowerKeyword)) {
          results.push({ path: relPath, name: entry, matches: matchedLines.slice(0, 5) });
        }
      }
    }
  }

  walk(repoDir, "");
  return results;
}
```

- [ ] **Step 10: 运行全部 git.test.ts 确认通过**

Run: `cd packages/gateway && bun test src/services/git.test.ts`
Expected: ALL PASS

- [ ] **Step 11: 提交**

```bash
git add packages/gateway/src/services/git.ts packages/gateway/src/services/git.test.ts
git commit -m "feat(gateway): git.ts 新增 deleteFile、renameFile、searchFiles"
```

---

### Task 3: Gateway — 新增 docs 路由

**Files:**

- Create: `packages/gateway/src/routes/docs.ts`
- Create: `packages/gateway/src/routes/docs.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: 创建 routes/docs.test.ts 测试文件**

```typescript
import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock git service
const mockListTree = mock(() => Promise.resolve([]));
const mockReadFile = mock(() => Promise.resolve("# Test"));
const mockWriteAndPush = mock(() => Promise.resolve());
const mockDeleteFile = mock(() => Promise.resolve());
const mockRenameFile = mock(() => Promise.resolve());
const mockSearchFiles = mock(() => Promise.resolve([]));
const mockEnsureRepo = mock(() => Promise.resolve());

mock.module("../services/git", () => ({
  listTree: mockListTree,
  readFile: mockReadFile,
  writeAndPush: mockWriteAndPush,
  deleteFile: mockDeleteFile,
  renameFile: mockRenameFile,
  searchFiles: mockSearchFiles,
  ensureRepo: mockEnsureRepo,
}));

// Mock wikijs
const mockTriggerSync = mock(() => Promise.resolve());
mock.module("../services/wikijs", () => ({
  triggerSync: mockTriggerSync,
}));

// Import after mocks
const { docsRoutes } = await import("./docs");
import { Hono } from "hono";

const app = new Hono();
app.route("/api/docs", docsRoutes);

function clearAll() {
  mockListTree.mockClear();
  mockReadFile.mockClear();
  mockWriteAndPush.mockClear();
  mockDeleteFile.mockClear();
  mockRenameFile.mockClear();
  mockSearchFiles.mockClear();
  mockEnsureRepo.mockClear();
  mockTriggerSync.mockClear();
}

describe("GET /api/docs/tree", () => {
  beforeEach(clearAll);

  it("returns directory tree", async () => {
    mockListTree.mockResolvedValue([
      { name: "prd", path: "prd", type: "directory", children: [] },
    ]);
    const res = await app.request("/api/docs/tree");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].name).toBe("prd");
    expect(mockListTree).toHaveBeenCalledWith("docs");
  });
});

describe("GET /api/docs/file", () => {
  beforeEach(clearAll);

  it("returns file content", async () => {
    mockReadFile.mockResolvedValue("# Hello");
    const res = await app.request("/api/docs/file?path=prd/test.md");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("# Hello");
  });

  it("returns 400 when path is missing", async () => {
    const res = await app.request("/api/docs/file");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/docs/file", () => {
  beforeEach(clearAll);

  it("creates file and triggers sync", async () => {
    const res = await app.request("/api/docs/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prd/new.md", content: "# New" }),
    });
    expect(res.status).toBe(201);
    expect(mockWriteAndPush).toHaveBeenCalledWith("docs", "prd/new.md", "# New", "docs: 新建 prd/new.md");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("PUT /api/docs/file", () => {
  beforeEach(clearAll);

  it("updates file and triggers sync", async () => {
    const res = await app.request("/api/docs/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prd/test.md", content: "# Updated" }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteAndPush).toHaveBeenCalledWith("docs", "prd/test.md", "# Updated", "docs: 更新 prd/test.md");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("DELETE /api/docs/file", () => {
  beforeEach(clearAll);

  it("deletes file and triggers sync", async () => {
    const res = await app.request("/api/docs/file?path=prd/old.md", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFile).toHaveBeenCalledWith("docs", "prd/old.md", "docs: 删除 prd/old.md");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("PUT /api/docs/rename", () => {
  beforeEach(clearAll);

  it("renames file and triggers sync", async () => {
    const res = await app.request("/api/docs/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: "prd/a.md", newPath: "prd/b.md" }),
    });
    expect(res.status).toBe(200);
    expect(mockRenameFile).toHaveBeenCalledWith("docs", "prd/a.md", "prd/b.md", "docs: 重命名 prd/a.md → prd/b.md");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("POST /api/docs/folder", () => {
  beforeEach(clearAll);

  it("creates folder with .gitkeep", async () => {
    const res = await app.request("/api/docs/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new-folder" }),
    });
    expect(res.status).toBe(201);
    expect(mockWriteAndPush).toHaveBeenCalledWith("docs", "new-folder/.gitkeep", "", "docs: 新建目录 new-folder");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("GET /api/docs/search", () => {
  beforeEach(clearAll);

  it("returns search results", async () => {
    mockSearchFiles.mockResolvedValue([
      { path: "prd/test.md", name: "test.md", matches: ["keyword found"] },
    ]);
    const res = await app.request("/api/docs/search?q=keyword");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.request("/api/docs/search");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/routes/docs.test.ts`
Expected: FAIL — cannot import `./docs`

- [ ] **Step 3: 创建 routes/docs.ts**

```typescript
import { Hono } from "hono";
import { listTree, readFile, writeAndPush, deleteFile, renameFile, searchFiles } from "../services/git";
import { triggerSync } from "../services/wikijs";

export const docsRoutes = new Hono();

const REPO = "docs";

docsRoutes.get("/tree", async (c) => {
  const tree = await listTree(REPO);
  return c.json({ data: tree });
});

docsRoutes.get("/file", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  const content = await readFile(REPO, path);
  return c.json({ content, path });
});

docsRoutes.post("/file", async (c) => {
  const { path, content } = await c.req.json<{ path: string; content: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  await writeAndPush(REPO, path, content ?? "", `docs: 新建 ${path}`);
  triggerSync();
  return c.json({ ok: true, path }, 201);
});

docsRoutes.put("/file", async (c) => {
  const { path, content } = await c.req.json<{ path: string; content: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  await writeAndPush(REPO, path, content, `docs: 更新 ${path}`);
  triggerSync();
  return c.json({ ok: true, path });
});

docsRoutes.delete("/file", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  await deleteFile(REPO, path, `docs: 删除 ${path}`);
  triggerSync();
  return c.json({ ok: true });
});

docsRoutes.post("/folder", async (c) => {
  const { path } = await c.req.json<{ path: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  await writeAndPush(REPO, `${path}/.gitkeep`, "", `docs: 新建目录 ${path}`);
  triggerSync();
  return c.json({ ok: true, path }, 201);
});

docsRoutes.put("/rename", async (c) => {
  const { oldPath, newPath } = await c.req.json<{ oldPath: string; newPath: string }>();
  if (!oldPath || !newPath) return c.json({ error: "oldPath and newPath are required" }, 400);
  await renameFile(REPO, oldPath, newPath, `docs: 重命名 ${oldPath} → ${newPath}`);
  triggerSync();
  return c.json({ ok: true });
});

docsRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ error: "q is required" }, 400);
  const results = await searchFiles(REPO, q);
  return c.json({ data: results });
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/docs.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 在 index.ts 中挂载 docs 路由**

在 `packages/gateway/src/index.ts` 中：

顶部追加 import：

```typescript
import { docsRoutes } from "./routes/docs";
```

在 `app.route("/api/workspaces", workspaceRoutes);` 之后追加：

```typescript
app.route("/api/docs", docsRoutes);
```

- [ ] **Step 6: 运行全部 Gateway 测试确认无回归**

Run: `cd packages/gateway && bun test`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add packages/gateway/src/routes/docs.ts packages/gateway/src/routes/docs.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): 新增文档管理 REST API 路由"
```

---

### Task 4: Web 前端 — API 封装 + Pinia Store

**Files:**

- Create: `packages/web/src/api/docs.ts`
- Create: `packages/web/src/stores/docs.ts`

- [ ] **Step 1: 创建 api/docs.ts**

参照 `api/workflow.ts` 的 `request` 封装模式。由于 `request` 函数在 `workflow.ts` 中定义且未导出，在 `docs.ts` 中复制同样的 request helper（与现有模式保持一致）：

```typescript
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
```

- [ ] **Step 2: 创建 stores/docs.ts**

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchTree,
  fetchFile,
  updateFile,
  createFile,
  deleteFile,
  createFolder,
  renameDoc,
  searchDocs,
  type TreeNode,
  type SearchResult,
} from "../api/docs";

export const useDocsStore = defineStore("docs", () => {
  const tree = ref<TreeNode[]>([]);
  const currentPath = ref<string | null>(null);
  const currentContent = ref("");
  const originalContent = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const searchQuery = ref("");
  const searchResults = ref<SearchResult[]>([]);

  const isDirty = computed(() => currentContent.value !== originalContent.value);
  const currentFileName = computed(() => {
    if (!currentPath.value) return null;
    return currentPath.value.split("/").pop() ?? null;
  });

  async function loadTree() {
    loading.value = true;
    try {
      const res = await fetchTree();
      tree.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function openFile(path: string) {
    loading.value = true;
    try {
      const res = await fetchFile(path);
      currentPath.value = path;
      currentContent.value = res.content;
      originalContent.value = res.content;
    } finally {
      loading.value = false;
    }
  }

  async function saveFile() {
    if (!currentPath.value || !isDirty.value) return;
    saving.value = true;
    try {
      await updateFile(currentPath.value, currentContent.value);
      originalContent.value = currentContent.value;
    } finally {
      saving.value = false;
    }
  }

  async function createNewFile(path: string, content: string = "") {
    await createFile(path, content);
    await loadTree();
    await openFile(path);
  }

  async function deleteCurrentFile() {
    if (!currentPath.value) return;
    await deleteFile(currentPath.value);
    currentPath.value = null;
    currentContent.value = "";
    originalContent.value = "";
    await loadTree();
  }

  async function createNewFolder(path: string) {
    await createFolder(path);
    await loadTree();
  }

  async function renameCurrentFile(newPath: string) {
    if (!currentPath.value) return;
    await renameDoc(currentPath.value, newPath);
    currentPath.value = newPath;
    await loadTree();
  }

  async function search(q: string) {
    searchQuery.value = q;
    if (!q.trim()) {
      searchResults.value = [];
      return;
    }
    const res = await searchDocs(q);
    searchResults.value = res.data;
  }

  function setContent(content: string) {
    currentContent.value = content;
  }

  function closeFile() {
    currentPath.value = null;
    currentContent.value = "";
    originalContent.value = "";
  }

  return {
    tree, currentPath, currentContent, originalContent, loading, saving,
    searchQuery, searchResults, isDirty, currentFileName,
    loadTree, openFile, saveFile, createNewFile, deleteCurrentFile,
    createNewFolder, renameCurrentFile, search, setContent, closeFile,
  };
});
```

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/api/docs.ts packages/web/src/stores/docs.ts
git commit -m "feat(web): 文档管理 API 封装 + Pinia store"
```

---

### Task 5: Web 前端 — 安装 Tiptap 依赖

**Files:**

- Modify: `packages/web/package.json`

- [ ] **Step 1: 安装 Tiptap 和 Turndown**

```bash
cd packages/web && npm install @tiptap/vue-3 @tiptap/starter-kit @tiptap/pm @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-task-list @tiptap/extension-task-item turndown
```

- [ ] **Step 2: 安装 Turndown 类型定义**

```bash
cd packages/web && npm install -D @types/turndown
```

- [ ] **Step 3: 确认安装成功**

Run: `cd packages/web && npm ls @tiptap/vue-3 turndown`
Expected: 输出版本号，无 MISSING

- [ ] **Step 4: 提交**

```bash
git add packages/web/package.json packages/web/package-lock.json
git commit -m "chore(web): 安装 Tiptap 编辑器和 Turndown 依赖"
```

---

### Task 6: Web 前端 — 创建 Docs.vue 页面

**Files:**

- Create: `packages/web/src/pages/Docs.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/components/AppLayout.vue`

- [ ] **Step 1: 创建 Docs.vue**

```vue
<template>
  <div class="flex -m-8" style="height: calc(100vh - 48px)">
    <!-- File Tree Sidebar -->
    <div
      class="w-64 shrink-0 flex flex-col"
      style="
        background-color: var(--color-bg-panel);
        border-right: 1px solid var(--color-border-subtle);
      "
    >
      <!-- Search -->
      <div class="p-3" style="border-bottom: 1px solid var(--color-border-subtle)">
        <input
          v-model="searchInput"
          type="text"
          placeholder="搜索文档..."
          class="w-full px-2.5 py-1.5 rounded-md text-xs outline-none"
          style="
            background-color: var(--color-surface-02);
            border: 1px solid var(--color-border-default);
            color: var(--color-text-secondary);
          "
          @input="handleSearch"
        />
      </div>

      <!-- Search Results or File Tree -->
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <!-- Search Results -->
        <template v-if="searchInput.trim()">
          <div class="tree-label">搜索结果</div>
          <div
            v-for="r in store.searchResults"
            :key="r.path"
            class="tree-item"
            @click="store.openFile(r.path)"
          >
            <span class="truncate">{{ r.name }}</span>
            <span class="tree-path">{{ r.path }}</span>
          </div>
          <div v-if="!store.searchResults.length" class="tree-empty">无结果</div>
        </template>

        <!-- File Tree -->
        <template v-else>
          <div class="tree-label">文档目录</div>
          <TreeItem
            v-for="node in store.tree"
            :key="node.path"
            :node="node"
            :depth="0"
            :active-path="store.currentPath"
            @select="handleFileSelect"
            @new-file="handleNewFileInDir"
            @new-folder="handleNewFolderInDir"
            @rename="handleRenameNode"
            @delete-node="handleDeleteNode"
          />
          <div v-if="!store.tree.length && !store.loading" class="tree-empty">暂无文档</div>
        </template>
      </div>

      <!-- New Button -->
      <div class="p-2" style="border-top: 1px solid var(--color-border-subtle)">
        <div class="flex gap-1.5">
          <button class="new-btn flex-1" @click="showNewFileDialog = true">+ 文件</button>
          <button class="new-btn flex-1" @click="showNewFolderDialog = true">+ 文件夹</button>
        </div>
      </div>
    </div>

    <!-- Editor Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Toolbar -->
      <div
        v-if="store.currentPath"
        class="px-4 py-2 flex items-center justify-between shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="flex items-center gap-1 text-xs" style="color: var(--color-text-tertiary)">
          <span
            v-for="(seg, i) in breadcrumbs"
            :key="i"
          >
            <span v-if="i > 0" style="color: var(--color-text-quaternary)"> / </span>
            <span
              :style="{
                color: i === breadcrumbs.length - 1
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-quaternary)',
                fontWeight: i === breadcrumbs.length - 1 ? 510 : 400,
              }"
            >{{ seg }}</span>
          </span>
          <span
            v-if="store.isDirty"
            class="w-2 h-2 rounded-full ml-2"
            style="background-color: var(--color-accent)"
          />
        </div>
        <div class="flex items-center gap-2">
          <button
            class="save-btn"
            :disabled="!store.isDirty || store.saving"
            @click="handleSave"
          >
            {{ store.saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </div>

      <!-- Tiptap Editor -->
      <div v-if="store.currentPath" class="flex-1 overflow-y-auto">
        <editor-content :editor="editor" class="docs-editor" />
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex-1 flex items-center justify-center"
      >
        <div class="text-center">
          <div
            class="text-sm mb-2"
            style="font-weight: 510; color: var(--color-text-tertiary)"
          >
            选择一个文档开始编辑
          </div>
          <div class="text-xs" style="color: var(--color-text-quaternary)">
            从左侧文件树中选择，或创建新文档
          </div>
        </div>
      </div>
    </div>

    <!-- New File Dialog -->
    <Teleport to="body">
      <div v-if="showNewFileDialog" class="dialog-overlay" @click.self="showNewFileDialog = false">
        <div class="dialog-box">
          <div class="dialog-title">新建文档</div>
          <input
            v-model="newFilePath"
            class="dialog-input"
            placeholder="文件路径，如 prd/new-feature.md"
            @keyup.enter="confirmNewFile"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showNewFileDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmNewFile">创建</button>
          </div>
        </div>
      </div>

      <div v-if="showNewFolderDialog" class="dialog-overlay" @click.self="showNewFolderDialog = false">
        <div class="dialog-box">
          <div class="dialog-title">新建文件夹</div>
          <input
            v-model="newFolderPath"
            class="dialog-input"
            placeholder="文件夹路径，如 tech-design"
            @keyup.enter="confirmNewFolder"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showNewFolderDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmNewFolder">创建</button>
          </div>
        </div>
      </div>

      <div v-if="showRenameDialog" class="dialog-overlay" @click.self="showRenameDialog = false">
        <div class="dialog-box">
          <div class="dialog-title">重命名</div>
          <input
            v-model="renamePath"
            class="dialog-input"
            placeholder="新路径"
            @keyup.enter="confirmRename"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showRenameDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmRename">确认</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { marked } from "marked";
import TurndownService from "turndown";
import { useDocsStore } from "../stores/docs";
import TreeItem from "../components/DocTreeItem.vue";

defineOptions({ name: "DocsPage" });

const store = useDocsStore();
const searchInput = ref("");
const showNewFileDialog = ref(false);
const showNewFolderDialog = ref(false);
const showRenameDialog = ref(false);
const newFilePath = ref("");
const newFolderPath = ref("");
const renamePath = ref("");
const renameOldPath = ref("");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const editor = useEditor({
  extensions: [
    StarterKit,
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
  editorProps: {
    attributes: {
      class: "prose prose-invert max-w-none px-8 py-6 outline-none",
    },
  },
  onUpdate: ({ editor: e }) => {
    const html = e.getHTML();
    const md = turndown.turndown(html);
    store.setContent(md);
  },
});

const breadcrumbs = computed(() => store.currentPath?.split("/") ?? []);

let searchTimeout: ReturnType<typeof setTimeout>;
function handleSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    store.search(searchInput.value);
  }, 300);
}

async function handleFileSelect(path: string) {
  if (store.isDirty) {
    if (!confirm("当前文档未保存，是否放弃修改？")) return;
  }
  await store.openFile(path);
}

watch(() => store.currentContent, (newContent) => {
  if (!editor.value) return;
  // Only set content when file is freshly loaded (not dirty)
  if (!store.isDirty || store.currentContent === store.originalContent) {
    const html = marked.parse(newContent) as string;
    editor.value.commands.setContent(html);
  }
}, { immediate: false });

// When a new file is opened, update editor
watch(() => store.currentPath, async () => {
  if (!editor.value || !store.currentPath) return;
  const html = marked.parse(store.currentContent) as string;
  editor.value.commands.setContent(html);
});

async function handleSave() {
  await store.saveFile();
}

async function confirmNewFile() {
  if (!newFilePath.value.trim()) return;
  const path = newFilePath.value.endsWith(".md") ? newFilePath.value : `${newFilePath.value}.md`;
  await store.createNewFile(path, `# ${path.split("/").pop()?.replace(".md", "")}\n`);
  showNewFileDialog.value = false;
  newFilePath.value = "";
}

async function confirmNewFolder() {
  if (!newFolderPath.value.trim()) return;
  await store.createNewFolder(newFolderPath.value);
  showNewFolderDialog.value = false;
  newFolderPath.value = "";
}

function handleNewFileInDir(dirPath: string) {
  newFilePath.value = `${dirPath}/`;
  showNewFileDialog.value = true;
}

function handleNewFolderInDir(dirPath: string) {
  newFolderPath.value = `${dirPath}/`;
  showNewFolderDialog.value = true;
}

function handleRenameNode(path: string) {
  renameOldPath.value = path;
  renamePath.value = path;
  showRenameDialog.value = true;
}

async function confirmRename() {
  if (!renamePath.value.trim() || renamePath.value === renameOldPath.value) return;
  if (store.currentPath === renameOldPath.value) {
    await store.renameCurrentFile(renamePath.value);
  } else {
    const { renameDoc } = await import("../api/docs");
    await renameDoc(renameOldPath.value, renamePath.value);
    await store.loadTree();
  }
  showRenameDialog.value = false;
  renamePath.value = "";
  renameOldPath.value = "";
}

async function handleDeleteNode(path: string) {
  if (!confirm(`确定删除 ${path}？`)) return;
  if (store.currentPath === path) {
    await store.deleteCurrentFile();
  } else {
    const { deleteFile } = await import("../api/docs");
    await deleteFile(path);
    await store.loadTree();
  }
}

// Warn before leaving with unsaved changes
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (store.isDirty) {
    e.preventDefault();
  }
}

onMounted(() => {
  store.loadTree();
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  editor.value?.destroy();
});
</script>

<style scoped>
.tree-label {
  padding: 4px 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-quaternary);
  font-weight: 510;
  margin-bottom: 2px;
}

.tree-item {
  display: flex;
  flex-direction: column;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 510;
  transition: all 120ms ease;
}

.tree-item:hover {
  background-color: var(--color-surface-03);
}

.tree-path {
  font-size: 10px;
  color: var(--color-text-quaternary);
  font-weight: 400;
}

.tree-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-quaternary);
  text-align: center;
}

.new-btn {
  padding: 5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 510;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-02);
  color: var(--color-text-secondary);
  transition: all 120ms ease;
}

.new-btn:hover {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
}

.save-btn {
  padding: 3px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 510;
  cursor: pointer;
  border: none;
  background-color: var(--color-accent);
  color: white;
  transition: all 120ms ease;
}

.save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-box {
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
  width: 400px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.dialog-title {
  font-size: 14px;
  font-weight: 510;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}

.dialog-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-02);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.dialog-input:focus {
  border-color: var(--color-accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.dialog-cancel {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 510;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: none;
  color: var(--color-text-secondary);
}

.dialog-confirm {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 510;
  cursor: pointer;
  border: none;
  background-color: var(--color-accent);
  color: white;
}
</style>

<style>
/* Tiptap editor global styles */
.docs-editor .ProseMirror {
  min-height: calc(100vh - 120px);
  padding: 24px 32px;
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 1.7;
}

.docs-editor .ProseMirror:focus {
  outline: none;
}

.docs-editor .ProseMirror h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 24px 0 8px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 20px 0 6px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror h3 {
  font-size: 16px;
  font-weight: 510;
  margin: 16px 0 4px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror p {
  margin: 4px 0;
  color: var(--color-text-secondary);
}

.docs-editor .ProseMirror ul,
.docs-editor .ProseMirror ol {
  padding-left: 24px;
  color: var(--color-text-secondary);
}

.docs-editor .ProseMirror code {
  background-color: var(--color-surface-05);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.docs-editor .ProseMirror pre {
  background-color: var(--color-surface-02);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}

.docs-editor .ProseMirror pre code {
  background: none;
  padding: 0;
}

.docs-editor .ProseMirror blockquote {
  border-left: 3px solid var(--color-accent);
  padding-left: 16px;
  margin-left: 0;
  color: var(--color-text-tertiary);
}

.docs-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.docs-editor .ProseMirror th,
.docs-editor .ProseMirror td {
  border: 1px solid var(--color-border-default);
  padding: 8px 12px;
  font-size: 13px;
}

.docs-editor .ProseMirror th {
  background-color: var(--color-surface-02);
  font-weight: 510;
}

.docs-editor .ProseMirror ul[data-type="taskList"] {
  list-style: none;
  padding-left: 4px;
}

.docs-editor .ProseMirror ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.docs-editor .ProseMirror ul[data-type="taskList"] li label {
  margin-top: 3px;
}
</style>
```

- [ ] **Step 2: 创建 DocTreeItem.vue 组件**

Create: `packages/web/src/components/DocTreeItem.vue`

```vue
<template>
  <div>
    <!-- Directory -->
    <div
      v-if="node.type === 'directory'"
      class="tree-node"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="expanded = !expanded"
      @contextmenu.prevent="showCtx = true"
    >
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2"
        style="opacity: 0.4; transition: transform 120ms"
        :style="{ transform: expanded ? 'rotate(90deg)' : '' }"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span class="truncate">{{ node.name }}</span>

      <!-- Context menu -->
      <div v-if="showCtx" class="ctx-menu" @click.stop>
        <div class="ctx-item" @click="$emit('newFile', node.path); showCtx = false">新建文件</div>
        <div class="ctx-item" @click="$emit('newFolder', node.path); showCtx = false">新建子文件夹</div>
        <div class="ctx-item" @click="$emit('rename', node.path); showCtx = false">重命名</div>
        <div class="ctx-item ctx-danger" @click="$emit('deleteNode', node.path); showCtx = false">删除</div>
      </div>
    </div>

    <!-- Children -->
    <template v-if="node.type === 'directory' && expanded">
      <TreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        @select="$emit('select', $event)"
        @new-file="$emit('newFile', $event)"
        @new-folder="$emit('newFolder', $event)"
        @rename="$emit('rename', $event)"
        @delete-node="$emit('deleteNode', $event)"
      />
    </template>

    <!-- File -->
    <div
      v-if="node.type === 'file'"
      class="tree-node"
      :style="{
        paddingLeft: `${depth * 16 + 28}px`,
        backgroundColor: activePath === node.path ? 'var(--color-surface-05)' : 'transparent',
        color: activePath === node.path ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
      }"
      @click="$emit('select', node.path)"
      @contextmenu.prevent="showCtx = true"
    >
      <span class="truncate">{{ node.name }}</span>

      <!-- Context menu -->
      <div v-if="showCtx" class="ctx-menu" @click.stop>
        <div class="ctx-item" @click="$emit('rename', node.path); showCtx = false">重命名</div>
        <div class="ctx-item ctx-danger" @click="$emit('deleteNode', node.path); showCtx = false">删除</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import type { TreeNode } from "../api/docs";

defineOptions({ name: "TreeItem" });

defineProps<{
  node: TreeNode;
  depth: number;
  activePath: string | null;
}>();

defineEmits<{
  select: [path: string];
  newFile: [dirPath: string];
  newFolder: [dirPath: string];
  rename: [path: string];
  deleteNode: [path: string];
}>();

const expanded = ref(false);
const showCtx = ref(false);

function closeCtx() {
  showCtx.value = false;
}

onMounted(() => document.addEventListener("click", closeCtx));
onBeforeUnmount(() => document.removeEventListener("click", closeCtx));
</script>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-secondary);
  transition: all 120ms ease;
  position: relative;
  user-select: none;
}

.tree-node:hover {
  background-color: var(--color-surface-03);
}

.ctx-menu {
  position: absolute;
  top: 100%;
  left: 16px;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 4px;
  z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 120px;
}

.ctx-item {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 120ms ease;
}

.ctx-item:hover {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
}

.ctx-danger:hover {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}
</style>
```

- [ ] **Step 3: 在 router/index.ts 中新增 /docs 路由**

在 `packages/web/src/router/index.ts` 的 `routes` 数组中，在 `chat` 路由之后追加：

```typescript
{
  path: "/docs",
  name: "docs",
  component: () => import("../pages/Docs.vue"),
},
```

- [ ] **Step 4: 在 AppLayout.vue 中添加侧边栏导航入口**

在 `packages/web/src/components/AppLayout.vue` 的 `<script setup>` 中：

在 `import { LayoutDashboard, MessageSquare, List, Zap, Settings } from "lucide-vue-next"` 中追加 `FileText`：

```typescript
import { LayoutDashboard, MessageSquare, List, Zap, Settings, FileText } from "lucide-vue-next";
```

在 `navItems` 的 `computed` 中，在 `{ path: "/chat", ... }` 之后追加：

```typescript
{ path: "/docs", label: "文档", icon: FileText },
```

- [ ] **Step 5: 本地验证页面渲染**

Run: `cd packages/web && npm run dev`

手动验证：

- 浏览器打开 <http://localhost:5173/docs>
- 页面应显示三栏布局（左侧文件树 + 右侧空状态）
- 侧边栏应出现「文档」导航项

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/Docs.vue packages/web/src/components/DocTreeItem.vue packages/web/src/router/index.ts packages/web/src/components/AppLayout.vue
git commit -m "feat(web): 文档管理页面 — 文件树 + Tiptap WYSIWYG 编辑器"
```

---

### Task 7: Web 前端 — nginx 代理配置

**Files:**

- Modify: `packages/web/nginx.conf` (如果存在) 或 `packages/web/Dockerfile`

- [ ] **Step 1: 检查现有 nginx 配置中是否已有 /api/ 代理**

查看 `packages/web/nginx.conf` 中已有的 proxy_pass 配置。需要确认 `/api/docs/` 路径会被正确代理到 Gateway。

如果已有 `/api/` 的通配代理（如 `location /api/ { proxy_pass http://gateway:3100; }`），则无需额外配置，跳过此 Task。

如果没有，在 nginx.conf 中追加：

```nginx
location /api/docs/ {
    proxy_pass http://gateway:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

- [ ] **Step 2: 提交（仅在修改了配置时）**

```bash
git add packages/web/nginx.conf
git commit -m "fix(web): nginx 增加 /api/docs/ 代理到 Gateway"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 运行 Gateway 全部测试**

Run: `cd packages/gateway && bun test`
Expected: ALL PASS（包括新增的 docs 路由和 git service 测试）

- [ ] **Step 2: 运行 Web 前端构建**

Run: `cd packages/web && npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 3: 本地联调验证**

启动 Gateway 和 Web dev server：

```bash
cd packages/gateway && bun run src/index.ts &
cd packages/web && npm run dev
```

手动验证清单：

1. 打开 <http://localhost:5173/docs>
2. 文件树加载并显示 docs 仓库结构
3. 点击 .md 文件，编辑器加载内容（WYSIWYG 渲染）
4. 编辑内容，文件名旁出现脏标记圆点
5. 点保存，内容写入 Git（检查 gateway 日志确认 commit + push）
6. 新建文件、新建文件夹功能正常
7. 右键菜单：重命名、删除功能正常
8. 搜索框输入关键词，显示匹配结果

- [ ] **Step 4: 最终提交（如有修复）**

```bash
git add -A
git commit -m "fix(web): 文档管理端到端修复"
```
