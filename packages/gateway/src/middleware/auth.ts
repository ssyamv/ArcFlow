import type { MiddlewareHandler } from "hono";
import { verifyJwt } from "../services/auth";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  // Pass through if an upstream middleware (e.g. test harness, reverse proxy)
  // already set userId on the context.
  if (c.get("userId")) {
    await next();
    return;
  }

  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = header.slice(7);
  try {
    const payload = await verifyJwt(token);
    c.set("userId", payload.sub);
    c.set("userRole", payload.role);
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
};
