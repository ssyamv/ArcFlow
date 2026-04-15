import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { callbackRoutes } from "./workflow-callback";

function makeApp(handleResult: boolean) {
  const fakeHandler = {
    handle: async () => handleResult,
  };
  return new Hono().route(
    "/api/workflow/callback",
    callbackRoutes({ handler: fakeHandler, systemSecret: "s3cr3t" }),
  );
}

describe("POST /api/workflow/callback", () => {
  it("401 without secret", async () => {
    const app = makeApp(true);
    const res = await app.request("/api/workflow/callback", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("400 with missing dispatch_id", async () => {
    const app = makeApp(true);
    const res = await app.request("/api/workflow/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": "s3cr3t" },
      body: JSON.stringify({ skill: "arcflow-prd-to-tech", status: "success" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 with missing skill", async () => {
    const app = makeApp(true);
    const res = await app.request("/api/workflow/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": "s3cr3t" },
      body: JSON.stringify({ dispatch_id: "d1", status: "success" }),
    });
    expect(res.status).toBe(400);
  });

  it("200 accepted=true on valid payload", async () => {
    const app = makeApp(true);
    const res = await app.request("/api/workflow/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": "s3cr3t" },
      body: JSON.stringify({
        dispatch_id: "d1",
        skill: "arcflow-prd-to-tech",
        status: "success",
        result: { content: "# Tech\nbody" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(true);
  });

  it("200 accepted=false on replay", async () => {
    const app = makeApp(false);
    const res = await app.request("/api/workflow/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": "s3cr3t" },
      body: JSON.stringify({
        dispatch_id: "d1",
        skill: "arcflow-prd-to-tech",
        status: "success",
        result: { content: "x" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(false);
  });
});
