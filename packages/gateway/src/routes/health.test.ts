import { describe, expect, it, afterEach, mock } from "bun:test";
import { createTestConfig } from "../test-config";

process.env.NODE_ENV = "test";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      planeBaseUrl: "http://plane-test:80",
      claudeCodeTimeout: 600000,
    }),
}));

// Import health routes directly to avoid full app initialization side effects
const { healthRoutes } = await import("./health");

describe("health dependencies", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /health still returns ok", async () => {
    const res = await healthRoutes.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns ok when all services reachable", async () => {
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.services.plane.status).toBe("ok");
    expect(typeof body.services.plane.latency_ms).toBe("number");
  });

  it("returns unhealthy when plane unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unhealthy");
    expect(body.services.plane.status).toBe("error");
    expect(body.services.plane.error).toBe("connection refused");
  });

  it("handles HTTP error responses as errors", async () => {
    globalThis.fetch = (async () =>
      new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.services.plane.status).toBe("error");
  });
});
