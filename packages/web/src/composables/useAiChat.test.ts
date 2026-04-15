import { vi, describe, it, expect } from "vitest";
import { createSseAuthHandler } from "./useAiChat";

describe("SSE auth handling", () => {
  it("on AUTH_EXPIRED calls refresh + reconnect", async () => {
    const refresh = vi.fn().mockResolvedValue("new.token");
    const reconnect = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect });
    await h({ type: "error", code: "AUTH_EXPIRED" });
    expect(refresh).toHaveBeenCalled();
    expect(reconnect).toHaveBeenCalled();
  });

  it("on refresh failure redirects to login", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("x"));
    const redirect = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect: () => {}, redirect });
    await h({ type: "error", code: "AUTH_EXPIRED" });
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("ignores non-AUTH_EXPIRED errors", async () => {
    const refresh = vi.fn();
    const reconnect = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect });
    await h({ type: "error", code: "AUTH_INVALID" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores non-error events", async () => {
    const refresh = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect: vi.fn() });
    await h({ type: "message" });
    expect(refresh).not.toHaveBeenCalled();
  });
});
