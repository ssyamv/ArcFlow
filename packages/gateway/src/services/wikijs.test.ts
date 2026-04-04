import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    wikijsBaseUrl: "http://localhost:3000",
    wikijsApiKey: "test-api-key",
  }),
}));

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
  mockFetchFn = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { storage: { executeAction: true } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

import { triggerSync } from "./wikijs";

describe("triggerSync", () => {
  it("should call storage.executeAction mutation", async () => {
    await triggerSync();
    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const callArgs = mockFetchFn.mock.calls[0];
    expect(callArgs[0]).toBe("http://localhost:3000/graphql");
    const body = JSON.parse(callArgs[1].body);
    expect(body.query).toContain("storage");
    expect(body.query).not.toContain("site");
  });
});
