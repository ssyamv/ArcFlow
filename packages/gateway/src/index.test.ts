import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDb, getDb } from "./db";

// 必须在 import app 之前设置 test 环境
process.env.NODE_ENV = "test";

import { app } from "./index";

describe("gateway app", () => {
  beforeEach(() => {
    getDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /version returns version", async () => {
    const res = await app.request("/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: "0.0.1" });
  });

  it("POST /webhook/plane is routed", async () => {
    const res = await app.request("/webhook/plane", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/workflow/trigger is routed", async () => {
    const { createWorkspace } = await import("./db/queries");
    const ws = createWorkspace({ name: "R", slug: "r-ws" });
    const res = await app.request("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: ws.id,
        workflow_type: "prd_to_tech",
        plane_issue_id: "TEST-1",
      }),
    });
    expect(res.status).toBe(200);
  });
});
