import { Hono } from "hono";
import type { createRagSearch } from "../services/rag-search";

export function ragRoutes(deps: {
  search: ReturnType<typeof createRagSearch>;
  systemSecret: string;
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.header("X-System-Secret") !== deps.systemSecret)
      return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  app.get("/search", async (c) => {
    const ws = c.req.query("workspace_id");
    const q = c.req.query("q");
    const topK = Number(c.req.query("top_k") ?? "8");
    if (!ws || !q) return c.json({ error: "workspace_id and q required" }, 400);
    const chunks = await deps.search.search({ workspaceId: ws, query: q, topK });
    return c.json({ chunks });
  });
  return app;
}
