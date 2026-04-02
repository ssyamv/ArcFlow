import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/version", (c) => c.json({ version: "0.0.1" }));

export default {
  port: 3100,
  fetch: app.fetch,
};
