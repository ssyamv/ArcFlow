import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    planeBaseUrl: "http://localhost:8082",
    planeApiToken: "test-token",
    planeWorkspaceSlug: "test-workspace",
  }),
}));

const { getIssue, updateIssueState, createBugIssue } = await import("./plane");

describe("plane service", () => {
  const originalFetch = globalThis.fetch;
  let mockFetchFn: ReturnType<typeof mock>;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    fetchCalls = [];
    mockFetchFn = mock(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          id: "issue-1",
          name: "Test Issue",
          description_html: "<p>desc</p>",
          state: "state-1",
          priority: "high",
          labels: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = mockFetchFn as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("getIssue", () => {
    it("should call correct URL with X-API-Key header", async () => {
      const issue = await getIssue("proj-1", "issue-1");

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe(
        "http://localhost:8082/api/v1/workspaces/test-workspace/projects/proj-1/issues/issue-1/",
      );

      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-token");
      expect(headers["Content-Type"]).toBe("application/json");

      expect(issue.id).toBe("issue-1");
      expect(issue.name).toBe("Test Issue");
    });
  });

  describe("createBugIssue", () => {
    it("should POST with correct body", async () => {
      const params = {
        name: "Bug: NPE",
        description_html: "<p>null pointer</p>",
        priority: "urgent",
        parent_issue_id: "parent-1",
      };

      const result = await createBugIssue("proj-1", params);

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe(
        "http://localhost:8082/api/v1/workspaces/test-workspace/projects/proj-1/issues/",
      );
      expect(fetchCalls[0].init.method).toBe("POST");

      const body = JSON.parse(fetchCalls[0].init.body as string);
      expect(body.name).toBe("Bug: NPE");
      expect(body.description_html).toBe("<p>null pointer</p>");
      expect(body.priority).toBe("urgent");
      expect(body.parent_issue_id).toBe("parent-1");

      expect(result.id).toBe("issue-1");
    });
  });

  describe("updateIssueState", () => {
    it("should PATCH with state in body", async () => {
      await updateIssueState("proj-1", "issue-1", "state-done");

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe(
        "http://localhost:8082/api/v1/workspaces/test-workspace/projects/proj-1/issues/issue-1/",
      );
      expect(fetchCalls[0].init.method).toBe("PATCH");

      const body = JSON.parse(fetchCalls[0].init.body as string);
      expect(body).toEqual({ state: "state-done" });

      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-token");
    });
  });

  describe("error handling", () => {
    const originalSetTimeout = globalThis.setTimeout;

    function skipRetryDelays() {
      // @ts-expect-error - mock setTimeout to execute callback immediately
      globalThis.setTimeout = (fn: () => void) => {
        fn();
        return 0;
      };
    }

    afterEach(() => {
      globalThis.setTimeout = originalSetTimeout;
    });

    it("throws on HTTP error response", async () => {
      skipRetryDelays();
      globalThis.fetch = (async () =>
        new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;

      await expect(getIssue("proj-1", "issue-1")).rejects.toThrow("Plane API error: 403");
    });

    it("retries on failure before throwing", async () => {
      skipRetryDelays();
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        throw new Error("connection refused");
      }) as unknown as typeof fetch;

      await expect(getIssue("proj-1", "issue-1")).rejects.toThrow("connection refused");
      expect(callCount).toBe(3); // initial + 2 retries
    });

    it("succeeds on retry after initial failure", async () => {
      skipRetryDelays();
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount === 1) throw new Error("timeout");
        return new Response(
          JSON.stringify({
            id: "issue-retry",
            name: "Retried",
            description_html: "",
            state: "s1",
            priority: "low",
            labels: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const issue = await getIssue("proj-1", "issue-1");
      expect(issue.id).toBe("issue-retry");
      expect(callCount).toBe(2);
    });
  });
});
