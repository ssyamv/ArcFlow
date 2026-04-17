import { Hono } from "hono";
import type { createCallbackHandler, CallbackPayload } from "../services/workflow-callback";

export function callbackRoutes(deps: {
  handler: ReturnType<typeof createCallbackHandler>;
  systemSecret: string;
}) {
  const app = new Hono();
  app.post("/", async (c) => {
    if (c.req.header("X-System-Secret") !== deps.systemSecret)
      return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json()) as CallbackPayload;
    if (!body.dispatch_id || !body.status) return c.json({ error: "bad payload" }, 400);
    const accepted = await deps.handler.handle(body);
    return c.json({ accepted });
  });
  return app;
}
