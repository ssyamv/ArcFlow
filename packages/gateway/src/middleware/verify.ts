import type { MiddlewareHandler } from "hono";
import { createHmac, timingSafeEqual } from "crypto";

export function createWebhookVerifier(
  headerName: string,
  expectedSecret: string,
): MiddlewareHandler {
  return async (c, next) => {
    if (!expectedSecret) {
      await next();
      return;
    }

    const provided = c.req.header(headerName);
    if (!provided) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Clone the request so body remains readable for subsequent handlers
    const clonedReq = c.req.raw.clone();
    const body = await clonedReq.text();
    const expectedSig = createHmac("sha256", expectedSecret).update(body).digest("hex");

    // Support both raw hex and "sha256=hex" prefix formats
    const normalizedProvided = provided.startsWith("sha256=") ? provided.slice(7) : provided;

    try {
      const a = Buffer.from(normalizedProvided, "hex");
      const b = Buffer.from(expectedSig, "hex");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}
