import { describe, expect, it, mock, afterEach } from "bun:test";

// Mock config to avoid env var masking in CI
mock.module("../config", () => ({
  getConfig: () => ({
    ibuildBaseUrl: "http://ibuild-test:8080",
    ibuildClientKey: "test-client-key",
    ibuildUser: "test-user",
  }),
}));

const { getAccessToken, _resetTokenCache } = await import("./ibuild");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetTokenCache();
});

// ─── Task 2: Token Management ─────────────────────────────────────────────────

describe("getAccessToken", () => {
  it("requests token from CS API and caches it", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(async () => {
      fetchCallCount++;
      return new Response(JSON.stringify({ token: "test-token-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    const token1 = await getAccessToken();
    const token2 = await getAccessToken();

    expect(token1).toBe("test-token-123");
    expect(token2).toBe("test-token-123");
    // Fetch should only be called once due to caching
    expect(fetchCallCount).toBe(1);
  });

  it("throws on API failure", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    await expect(getAccessToken()).rejects.toThrow("iBuild token request failed: 500");
  });
});
