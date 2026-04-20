import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      planeBaseUrl: "http://localhost:8082",
      planeApiToken: "test-token",
    }),
}));

const getWorkspace = mock(() => ({
  id: 1,
  name: "Test WS",
  slug: "test-ws",
  plane_project_id: "proj-1",
  plane_workspace_slug: "plane-ws",
  wiki_path_prefix: null,
  git_repos: "{}",
  feishu_chat_id: null,
  created_at: "",
  updated_at: "",
}));

mock.module("../db/queries", () => ({
  getWorkspace,
}));

const { getIssue, updateIssueState, createBugIssue, listIssuesByAssignee, commentPlaneIssue } =
  await import("./plane");

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
      const issue = await getIssue("test-workspace", "proj-1", "issue-1");

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

      const result = await createBugIssue("test-workspace", "proj-1", params);

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
      await updateIssueState("test-workspace", "proj-1", "issue-1", "state-done");

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

      await expect(getIssue("test-workspace", "proj-1", "issue-1")).rejects.toThrow(
        "Plane API error: 403",
      );
    });

    it("retries on failure before throwing", async () => {
      skipRetryDelays();
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        throw new Error("connection refused");
      }) as unknown as typeof fetch;

      await expect(getIssue("test-workspace", "proj-1", "issue-1")).rejects.toThrow(
        "connection refused",
      );
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

      const issue = await getIssue("test-workspace", "proj-1", "issue-1");
      expect(issue.id).toBe("issue-retry");
      expect(callCount).toBe(2);
    });
  });
  describe("listIssuesByAssignee", () => {
    it("queries Plane issues by assignee email", async () => {
      mockFetchFn = mock(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ results: [{ id: "ISS-1", name: "Need review" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      globalThis.fetch = mockFetchFn as unknown as typeof fetch;

      const items = await listIssuesByAssignee("test-workspace", "proj-1", "me@example.com");

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe(
        "http://localhost:8082/api/v1/workspaces/test-workspace/projects/proj-1/issues/?assignee__email=me%40example.com",
      );
      expect(items).toEqual([{ id: "ISS-1", name: "Need review" }]);
    });
  });

  describe("commentPlaneIssue", () => {
    it("posts comment_html to the Plane work-item comment endpoint", async () => {
      mockFetchFn = mock(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ id: "c-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      globalThis.fetch = mockFetchFn as unknown as typeof fetch;

      await commentPlaneIssue(1, "ISS-22", "First line\nSecond line");

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe(
        "http://localhost:8082/api/v1/workspaces/plane-ws/projects/proj-1/work-items/ISS-22/comments/",
      );
      expect(fetchCalls[0].init.method).toBe("POST");
      const body = JSON.parse(fetchCalls[0].init.body as string);
      expect(body).toEqual({ comment_html: "First line<br />Second line" });
      const headers = fetchCalls[0].init.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-token");
      expect(getWorkspace).toHaveBeenCalledWith(1);
    });
  });
});
