import { describe, expect, it } from "bun:test";
import { app } from "./index";

describe("gateway health check", () => {
  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
