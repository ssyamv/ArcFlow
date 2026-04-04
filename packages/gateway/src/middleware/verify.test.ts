import { describe, expect, it } from "bun:test";
import { createHmac } from "crypto";
import { Hono } from "hono";
import { createWebhookVerifier } from "./verify";

function createTestApp(headerName: string, secret: string) {
  const app = new Hono();
  app.use("/*", createWebhookVerifier(headerName, secret));
  app.post("/test", async (c) => {
    const body = await c.req.json();
    return c.json({ ok: true, body });
  });
  return app;
}

describe("webhook verify middleware", () => {
  it("returns 401 when signature header is missing", async () => {
    const app = createTestApp("X-Signature", "my-secret");
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when HMAC signature is wrong", async () => {
    const app = createTestApp("X-Signature", "my-secret");
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": "deadbeef",
      },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("passes when HMAC-SHA256 signature is correct (raw hex)", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body.event).toBe("test");
  });

  it("passes when signature has sha256= prefix", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test" });
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("skips verification when secret is not configured", async () => {
    const app = createTestApp("X-Signature", "");
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("allows subsequent middleware to read the body after verification", async () => {
    const secret = "my-secret";
    const body = JSON.stringify({ event: "test", data: "important" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const app = createTestApp("X-Signature", secret);
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.body.data).toBe("important");
  });
});
