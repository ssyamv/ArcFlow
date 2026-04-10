import { describe, expect, it, afterEach, mock } from "bun:test";
import { createTestConfig } from "../test-config";

process.env.NODE_ENV = "test";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      planeBaseUrl: "http://plane-test:80",
      wikijsBaseUrl: "http://wikijs-test:3000",
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
    expect(body.services.dify.status).toBe("ok");
    expect(body.services.plane.status).toBe("ok");
    expect(typeof body.services.dify.latency_ms).toBe("number");
  });

  it("returns degraded when some services unreachable", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      // Make Dify fail, others succeed
      if (url.includes("dify-test")) throw new Error("connection refused");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.services.dify.status).toBe("error");
    expect(body.services.dify.error).toBe("connection refused");
    expect(body.services.plane.status).toBe("ok");
  });

  it("returns unhealthy when all services unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unhealthy");
  });

  it("handles HTTP error responses as errors", async () => {
    globalThis.fetch = (async () =>
      new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

    const res = await healthRoutes.request("/health/dependencies");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.services.dify.status).toBe("error");
  });
});
