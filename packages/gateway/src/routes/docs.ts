import { Hono } from "hono";
import {
  listTree,
  readFile,
  writeAndPush,
  deleteFile,
  renameFile,
  searchFiles,
} from "../services/git";
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
