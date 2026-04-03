import type { MiddlewareHandler } from "hono";
import type { WebhookSource } from "../types";
import { isEventProcessed, recordWebhookEvent } from "../db/queries";

export function createDedup(headerName: string, source: WebhookSource): MiddlewareHandler {
  return async (c, next) => {
    const eventId = c.req.header(headerName);

    if (!eventId) {
      await next();
      return;
    }

    if (isEventProcessed(eventId)) {
      return c.json({ message: "Event already processed" }, 200);
    }

    recordWebhookEvent(eventId, source);
    await next();
  };
}
