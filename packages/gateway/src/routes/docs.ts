import { Hono } from "hono";
import {
  listTree,
  readFile,
  writeAndPush,
  deleteFile,
  renameFile,
  searchFiles,
  ensureRepoByUrl,
  getRepoDir,
  registerRepoUrl,
} from "../services/git";
import { triggerSync } from "../services/wikijs";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { getWorkspace } from "../db/queries";
import { getConfig } from "../config";

export const docsRoutes = new Hono();

docsRoutes.use("/*", authMiddleware, workspaceMiddleware);

/**
 * 获取当前工作空间的 docs 仓库名称。
 * 工作空间各自独立：目录名为 ws-{id}-docs，仓库 URL 从 workspace.git_repos.docs 读取。
 * 如果工作空间未配置 docs 仓库，回退到全局 DOCS_GIT_REPO（旧的 "docs" 仓库）。
 */
function getDocsRepoInfo(c: { get: (key: string) => unknown }): {
  repoName: string;
  repoUrl: string | null;
} {
  const workspaceId = c.get("workspaceId") as number | null;
  if (workspaceId) {
    const ws = getWorkspace(workspaceId);
    if (ws) {
      try {
        const repos = JSON.parse(ws.git_repos || "{}");
        if (repos.docs) {
          return { repoName: `ws-${workspaceId}-docs`, repoUrl: repos.docs };
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  // 回退到全局配置
  const config = getConfig();
  return { repoName: "docs", repoUrl: config.docsGitRepo || null };
}

/**
 * 确保工作空间的 docs 仓库就绪
 */
async function ensureWorkspaceDocs(repoName: string, repoUrl: string | null): Promise<void> {
  if (!repoUrl) throw new Error("文档仓库未配置，请在工作空间设置中配置 docs Git 仓库 URL");
  // 注册到动态表，这样 listTree / searchFiles 内部的 ensureRepo 也能找到
  registerRepoUrl(repoName, repoUrl);
  const repoDir = getRepoDir(repoName);
  await ensureRepoByUrl(repoDir, repoUrl);
}

docsRoutes.get("/tree", async (c) => {
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  if (!repoUrl) return c.json({ data: [] });
  await ensureWorkspaceDocs(repoName, repoUrl);
  const tree = await listTree(repoName);
  return c.json({ data: tree });
});

docsRoutes.get("/file", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  const content = await readFile(repoName, path);
  return c.json({ content, path });
});

docsRoutes.post("/file", async (c) => {
  const { path, content } = await c.req.json<{ path: string; content: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  await writeAndPush(repoName, path, content ?? "", `docs: 新建 ${path}`);
  triggerSync();
  return c.json({ ok: true, path }, 201);
});

docsRoutes.put("/file", async (c) => {
  const { path, content } = await c.req.json<{ path: string; content: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  await writeAndPush(repoName, path, content, `docs: 更新 ${path}`);
  triggerSync();
  return c.json({ ok: true, path });
});

docsRoutes.delete("/file", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  await deleteFile(repoName, path, `docs: 删除 ${path}`);
  triggerSync();
  return c.json({ ok: true });
});

docsRoutes.post("/folder", async (c) => {
  const { path } = await c.req.json<{ path: string }>();
  if (!path) return c.json({ error: "path is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  await writeAndPush(repoName, `${path}/.gitkeep`, "", `docs: 新建目录 ${path}`);
  triggerSync();
  return c.json({ ok: true, path }, 201);
});

docsRoutes.put("/rename", async (c) => {
  const { oldPath, newPath } = await c.req.json<{ oldPath: string; newPath: string }>();
  if (!oldPath || !newPath) return c.json({ error: "oldPath and newPath are required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  await ensureWorkspaceDocs(repoName, repoUrl);
  await renameFile(repoName, oldPath, newPath, `docs: 重命名 ${oldPath} → ${newPath}`);
  triggerSync();
  return c.json({ ok: true });
});

docsRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ error: "q is required" }, 400);
  const { repoName, repoUrl } = getDocsRepoInfo(c);
  if (!repoUrl) return c.json({ data: [] });
  await ensureWorkspaceDocs(repoName, repoUrl);
  const results = await searchFiles(repoName, q);
  return c.json({ data: results });
});
