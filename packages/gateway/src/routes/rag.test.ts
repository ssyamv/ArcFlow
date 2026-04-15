import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { ragRoutes } from "./rag";

describe("GET /api/rag/search", () => {
  const fakeSearch = {
    search: async () => [{ docPath: "a.md", heading: "H", content: "c", score: 0.9 }],
  };
  const app = new Hono().route(
    "/api/rag",
    ragRoutes({ search: fakeSearch, systemSecret: "s3cr3t" }),
  );

  it("401 without secret", async () => {
    const res = await app.request("/api/rag/search?workspace_id=w&q=x&top_k=2");
    expect(res.status).toBe(401);
  });

  it("400 without workspace_id", async () => {
    const res = await app.request("/api/rag/search?q=x", {
      headers: { "X-System-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(400);
  });

  it("200 with chunks", async () => {
    const res = await app.request("/api/rag/search?workspace_id=w&q=hello&top_k=3", {
      headers: { "X-System-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunks.length).toBe(1);
    expect(body.chunks[0].heading).toBe("H");
  });
});
