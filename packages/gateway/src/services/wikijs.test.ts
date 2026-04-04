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

import { triggerSync, searchPages } from "./wikijs";

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

  it("should not throw when fetch fails", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network error"))) as unknown as typeof fetch;
    // triggerSync swallows errors internally
    await triggerSync();
  });

  it("should not throw when response is not ok", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("error", { status: 500 }))) as unknown as typeof fetch;
    await triggerSync();
  });
});

describe("searchPages", () => {
  it("should send search query with correct variables", async () => {
    const searchResponse = {
      data: {
        pages: {
          search: {
            results: [{ id: 1, title: "Test", path: "/test", description: "desc" }],
            totalHits: 1,
          },
        },
      },
    };
    mockFetchFn = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(searchResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = mockFetchFn as unknown as typeof fetch;

    const result = await searchPages("test query");

    expect(mockFetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetchFn.mock.calls[0][1].body);
    expect(body.variables).toEqual({ query: "test query" });
    expect(body.query).toContain("search");
    expect(result).toEqual(searchResponse);
  });

  it("should include authorization header", async () => {
    await searchPages("query");

    const headers = mockFetchFn.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("should return null on HTTP error", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("error", { status: 401 }))) as unknown as typeof fetch;

    const result = await searchPages("query");
    expect(result).toBeNull();
  });
});
