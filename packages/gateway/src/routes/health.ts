import { Hono } from "hono";
import { getConfig } from "../config";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => c.json({ status: "ok" }));
healthRoutes.get("/version", (c) => c.json({ version: "0.0.1" }));

interface ServiceCheck {
  status: "ok" | "error";
  latency_ms: number;
  error?: string;
}

async function checkService(url: string, timeout = 5000): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { status: "error", latency_ms: Date.now() - start, error: `HTTP ${res.status}` };
    }
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

healthRoutes.get("/health/dependencies", async (c) => {
  const config = getConfig();

  const names = ["dify", "plane", "wikijs"] as const;
  const urls = [
    `${config.difyBaseUrl}/health`,
    `${config.planeBaseUrl}/api/v1/`,
    `${config.wikijsBaseUrl}/healthz`,
  ];

  const checks = await Promise.all(urls.map((url) => checkService(url)));

  const services: Record<string, ServiceCheck> = {};
  names.forEach((name, i) => {
    services[name] = checks[i];
  });

  const okCount = checks.filter((ch) => ch.status === "ok").length;
  const status = okCount === checks.length ? "ok" : okCount === 0 ? "unhealthy" : "degraded";

  return c.json({ status, services }, status === "ok" ? 200 : 503);
});
