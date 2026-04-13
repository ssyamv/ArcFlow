import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import * as gitService from "../services/git";
import { authMiddleware as defaultAuthMiddleware } from "../middleware/auth";
import { workspaceMiddleware as defaultWorkspaceMiddleware } from "../middleware/workspace";
import * as queries from "../db/queries";
import { getConfig } from "../config";

export interface DocsRouteDeps {
  listTree: typeof gitService.listTree;
  readFile: typeof gitService.readFile;
  writeAndPush: typeof gitService.writeAndPush;
  deleteFile: typeof gitService.deleteFile;
  renameFile: typeof gitService.renameFile;
  searchFiles: typeof gitService.searchFiles;
  ensureRepoByUrl: typeof gitService.ensureRepoByUrl;
  getRepoDir: typeof gitService.getRepoDir;
  registerRepoUrl: typeof gitService.registerRepoUrl;
  getWorkspace: typeof queries.getWorkspace;
  authMiddleware: MiddlewareHandler;
  workspaceMiddleware: MiddlewareHandler;
  getGitWorkDir: () => string;
}

function defaultDeps(): DocsRouteDeps {
  return {
    listTree: gitService.listTree,
    readFile: gitService.readFile,
    writeAndPush: gitService.writeAndPush,
    deleteFile: gitService.deleteFile,
    renameFile: gitService.renameFile,
    searchFiles: gitService.searchFiles,
    ensureRepoByUrl: gitService.ensureRepoByUrl,
    getRepoDir: gitService.getRepoDir,
    registerRepoUrl: gitService.registerRepoUrl,
    getWorkspace: queries.getWorkspace,
    authMiddleware: defaultAuthMiddleware,
    workspaceMiddleware: defaultWorkspaceMiddleware,
    getGitWorkDir: () => getConfig().gitWorkDir,
  };
}

export function createDocsRoutes(overrides?: Partial<DocsRouteDeps>): Hono {
  const deps = { ...defaultDeps(), ...overrides };
  const router = new Hono();

  router.use("/*", deps.authMiddleware, deps.workspaceMiddleware);

  /**
   * 获取当前工作空间的 docs 仓库名称和 URL。
   * 目录名：ws-{id}-docs；仓库 URL 从 workspace.git_repos.docs 读取。
   */
  function getDocsRepoInfo(c: { get: (key: string) => unknown }): {
    repoName: string;
    repoUrl: string | null;
  } {
    const workspaceId = c.get("workspaceId") as number | null;
    if (!workspaceId) return { repoName: "", repoUrl: null };
    const ws = deps.getWorkspace(workspaceId);
    if (!ws) return { repoName: "", repoUrl: null };
    try {
      const repos = JSON.parse(ws.git_repos || "{}");
      if (repos.docs) {
        return { repoName: `ws-${workspaceId}-docs`, repoUrl: repos.docs };
      }
    } catch {
      // ignore parse errors
    }
    return { repoName: "", repoUrl: null };
  }

  async function ensureWorkspaceDocs(repoName: string, repoUrl: string | null): Promise<void> {
    if (!repoUrl) throw new Error("文档仓库未配置，请在工作空间设置中配置 docs Git 仓库 URL");
    deps.registerRepoUrl(repoName, repoUrl);
    const repoDir = deps.getRepoDir(repoName);
    await deps.ensureRepoByUrl(repoDir, repoUrl);
  }

  router.get("/tree", async (c) => {
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    if (!repoUrl) return c.json({ data: [] });
    await ensureWorkspaceDocs(repoName, repoUrl);
    const tree = await deps.listTree(repoName);
    return c.json({ data: tree });
  });

  router.get("/file", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    const content = await deps.readFile(repoName, path);
    return c.json({ content, path });
  });

  router.post("/file", async (c) => {
    const { path, content } = await c.req.json<{ path: string; content: string }>();
    if (!path) return c.json({ error: "path is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    await deps.writeAndPush(repoName, path, content ?? "", `docs: 新建 ${path}`);
    return c.json({ ok: true, path }, 201);
  });

  router.put("/file", async (c) => {
    const { path, content } = await c.req.json<{ path: string; content: string }>();
    if (!path) return c.json({ error: "path is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    await deps.writeAndPush(repoName, path, content, `docs: 更新 ${path}`);
    return c.json({ ok: true, path });
  });

  router.delete("/file", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    await deps.deleteFile(repoName, path, `docs: 删除 ${path}`);
    return c.json({ ok: true });
  });

  router.post("/folder", async (c) => {
    const { path } = await c.req.json<{ path: string }>();
    if (!path) return c.json({ error: "path is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    await deps.writeAndPush(repoName, `${path}/.gitkeep`, "", `docs: 新建目录 ${path}`);
    return c.json({ ok: true, path }, 201);
  });

  router.put("/rename", async (c) => {
    const { oldPath, newPath } = await c.req.json<{ oldPath: string; newPath: string }>();
    if (!oldPath || !newPath) return c.json({ error: "oldPath and newPath are required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    await ensureWorkspaceDocs(repoName, repoUrl);
    await deps.renameFile(repoName, oldPath, newPath, `docs: 重命名 ${oldPath} → ${newPath}`);
    return c.json({ ok: true });
  });

  router.get("/search", async (c) => {
    const q = c.req.query("q");
    if (!q?.trim()) return c.json({ error: "q is required" }, 400);
    const { repoName, repoUrl } = getDocsRepoInfo(c);
    if (!repoUrl) return c.json({ data: [] });
    await ensureWorkspaceDocs(repoName, repoUrl);
    const results = await deps.searchFiles(repoName, q);
    return c.json({ data: results });
  });

  return router;
}

// 默认导出，兼容 index.ts 的 `import { docsRoutes }`
export const docsRoutes = createDocsRoutes();
