import { describe, expect, it, mock, afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_GIT_DIR = "/tmp/rag-sync-test-git";

mock.module("../config", () => ({
  getConfig: () => ({
    difyBaseUrl: "http://dify-test:3001",
    difyDatasetApiKey: "dataset-key",
    difyDatasetId: "ds-default",
    difyDatasetMap: {
      "proj-alpha": { datasetId: "ds-alpha", ragApiKey: "rag-alpha" },
    },
    gitWorkDir: TEST_GIT_DIR,
  }),
}));

const { syncRecentChanges, syncGitToDify, syncAllDatasets, resetSyncState } =
  await import("./rag-sync");

const originalFetch = globalThis.fetch;

function difyDocsJson(docs: Array<{ id: string; name: string }>) {
  return JSON.stringify({
    data: docs.map((d) => ({ ...d, indexing_status: "completed" })),
    total: docs.length,
  });
}

const jsonHeaders = { "Content-Type": "application/json" };

function mockFetch(
  handlers: Array<{
    match: string | ((url: string) => boolean);
    response: Response | (() => Response);
  }>,
) {
  globalThis.fetch = (async (url: string) => {
    const urlStr = String(url);
    for (const h of handlers) {
      const matched = typeof h.match === "string" ? urlStr.includes(h.match) : h.match(urlStr);
      if (matched) {
        return typeof h.response === "function" ? h.response() : h.response.clone();
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

function createTestRepo(name: string, files: Record<string, string>) {
  const repoDir = join(TEST_GIT_DIR, name);
  mkdirSync(repoDir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, filePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }
  return repoDir;
}

describe("rag-sync", () => {
  beforeEach(() => {
    rmSync(TEST_GIT_DIR, { recursive: true, force: true });
    mkdirSync(TEST_GIT_DIR, { recursive: true });
    resetSyncState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(TEST_GIT_DIR, { recursive: true, force: true });
  });

  describe("syncRecentChanges", () => {
    it("returns empty result when no docs repos exist", async () => {
      const result = await syncRecentChanges(10);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it("creates new documents for recent files not in Dify", async () => {
      createTestRepo("ws-1-docs", { "prd/feature.md": "# New Feature\nContent here" });

      mockFetch([
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
        { match: "create-by-file", response: new Response(JSON.stringify({}), { status: 200 }) },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.created).toBe(1);
    });

    it("updates existing documents for recent files in Dify", async () => {
      createTestRepo("ws-1-docs", { "tech/existing.md": "Updated content" });

      mockFetch([
        {
          match: "documents?",
          response: new Response(difyDocsJson([{ id: "doc-existing", name: "tech-existing.md" }]), {
            headers: jsonHeaders,
          }),
        },
        { match: "update-by-file", response: new Response(JSON.stringify({}), { status: 200 }) },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });

    it("records errors when Dify create fails", async () => {
      createTestRepo("ws-1-docs", { "fail.md": "Some content" });

      mockFetch([
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
        { match: "create-by-file", response: new Response("Error", { status: 500 }) },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Create failed");
    });
  });

  describe("syncGitToDify", () => {
    it("creates, updates, and deletes documents", async () => {
      createTestRepo("docs", {
        "page-a.md": "Content A",
        "page-b.md": "Content B",
      });

      mockFetch([
        {
          match: "documents?",
          response: new Response(
            difyDocsJson([
              { id: "doc-a", name: "page-a.md" },
              { id: "doc-orphan", name: "deleted-page.md" },
            ]),
            { headers: jsonHeaders },
          ),
        },
        { match: "update-by-file", response: new Response(JSON.stringify({}), { status: 200 }) },
        { match: "create-by-file", response: new Response(JSON.stringify({}), { status: 200 }) },
        {
          match: (url) => url.includes("/documents/doc-orphan") && !url.includes("?"),
          response: new Response(JSON.stringify({}), { status: 200 }),
        },
      ]);

      const result = await syncGitToDify();
      expect(result.updated).toBe(1);
      expect(result.created).toBe(1);
      expect(result.deleted).toBe(1);
    });

    it("uses targetDatasetId when provided", async () => {
      let capturedUrl = "";
      createTestRepo("docs", {});

      mockFetch([
        {
          match: (url) => {
            if (url.includes("documents?")) {
              capturedUrl = url;
              return true;
            }
            return false;
          },
          response: new Response(difyDocsJson([]), { headers: jsonHeaders }),
        },
      ]);

      await syncGitToDify("custom-dataset-id");
      expect(capturedUrl).toContain("custom-dataset-id");
    });

    it("throws when dataset id is empty", async () => {
      await expect(syncGitToDify("")).rejects.toThrow(
        "DIFY_DATASET_API_KEY and DIFY_DATASET_ID are required",
      );
    });

    it("handles update failure", async () => {
      createTestRepo("docs", { "page-x.md": "content" });

      mockFetch([
        {
          match: "documents?",
          response: new Response(difyDocsJson([{ id: "doc-x", name: "page-x.md" }]), {
            headers: jsonHeaders,
          }),
        },
        { match: "update-by-file", response: new Response("Error", { status: 500 }) },
      ]);

      const result = await syncGitToDify();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Update failed");
    });

    it("handles delete failure", async () => {
      // No files in repo, but orphan in Dify
      createTestRepo("docs", {});

      mockFetch([
        {
          match: "documents?",
          response: new Response(difyDocsJson([{ id: "doc-orphan", name: "orphan.md" }]), {
            headers: jsonHeaders,
          }),
        },
        {
          match: (url) => url.includes("/documents/doc-orphan") && !url.includes("?"),
          response: new Response("Error", { status: 500 }),
        },
      ]);

      const result = await syncGitToDify();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Delete failed");
    });
  });

  describe("syncAllDatasets", () => {
    it("syncs default and project-specific datasets", async () => {
      createTestRepo("docs", {});

      mockFetch([
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
      ]);

      const results = await syncAllDatasets();
      expect(results["default"]).toBeDefined();
      expect(results["proj-alpha"]).toBeDefined();
      expect(results["default"].errors.length).toBe(0);
      expect(results["proj-alpha"].errors.length).toBe(0);
    });
  });
});
