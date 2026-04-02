import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 3100,
  fetch: app.fetch,
};
