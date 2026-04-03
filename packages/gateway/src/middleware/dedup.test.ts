import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDedup } from "./dedup";
import { closeDb, getDb } from "../db";

describe("webhook dedup middleware", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("allows first request through", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-100" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects duplicate request", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-200" },
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Event-Id": "evt-200" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Event already processed");
  });

  it("allows request without event ID header", async () => {
    const app = new Hono();
    app.use("/*", createDedup("X-Event-Id", "plane"));
    app.post("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
