import { describe, expect, it, mock, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    wikijsBaseUrl: "http://wikijs-test:3000",
    wikijsApiKey: "wiki-key",
    difyBaseUrl: "http://dify-test:3001",
    difyDatasetApiKey: "dataset-key",
    difyDatasetId: "ds-default",
    difyDatasetMap: {
      "proj-alpha": { datasetId: "ds-alpha", ragApiKey: "rag-alpha" },
    },
  }),
}));

const { syncRecentChanges, syncWikiToDify, syncAllDatasets } = await import("./rag-sync");

const originalFetch = globalThis.fetch;

function wikiPagesJson(pages: Array<{ id: number; path: string; updatedAt: string }>) {
  return JSON.stringify({
    data: { pages: { list: pages.map((p) => ({ ...p, title: p.path })) } },
  });
}

function wikiContentJson(content: string) {
  return JSON.stringify({ data: { pages: { single: { content } } } });
}

function difyDocsJson(docs: Array<{ id: string; name: string }>) {
  return JSON.stringify({
    data: docs.map((d) => ({ ...d, indexing_status: "completed" })),
    total: docs.length,
  });
}

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Build a fetch mock that dispatches based on URL patterns.
 * handlers: array of { match, response } where match is a string to check via includes().
 * First matching handler wins. Falls back to 404.
 */
function mockFetch(
  handlers: Array<{
    match: string | ((url: string) => boolean);
    response: Response | (() => Response);
  }>,
) {
  const counts = new Map<number, number>();
  globalThis.fetch = (async (url: string) => {
    const urlStr = String(url);
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      const n = (counts.get(i) ?? 0) + 1;
      const matched = typeof h.match === "string" ? urlStr.includes(h.match) : h.match(urlStr);
      if (matched) {
        counts.set(i, n);
        return typeof h.response === "function" ? h.response() : h.response.clone();
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("rag-sync", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("syncRecentChanges", () => {
    // Use a future timestamp to guarantee pages are "recent" regardless of lastSyncTime state
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    it("returns empty result when no recent pages", async () => {
      mockFetch([
        {
          match: "graphql",
          response: new Response(
            wikiPagesJson([{ id: 1, path: "old", updatedAt: "2020-01-01T00:00:00Z" }]),
            { headers: jsonHeaders },
          ),
        },
      ]);

      const result = await syncRecentChanges(10);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it("creates new documents for recent pages not in Dify", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 10, path: "prd/new-feature", updatedAt: futureDate }]),
                { headers: jsonHeaders },
              );
            }
            return new Response(wikiContentJson("# New Feature\nContent here"), {
              headers: jsonHeaders,
            });
          },
        },
        {
          match: "documents?",
          response: new Response(difyDocsJson([]), { headers: jsonHeaders }),
        },
        {
          match: "create-by-file",
          response: new Response(JSON.stringify({}), { status: 200 }),
        },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.created).toBe(1);
    });

    it("updates existing documents for recent pages in Dify", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 20, path: "tech/existing", updatedAt: futureDate }]),
                { headers: jsonHeaders },
              );
            }
            return new Response(wikiContentJson("Updated content"), { headers: jsonHeaders });
          },
        },
        {
          match: "documents?",
          response: new Response(difyDocsJson([{ id: "doc-existing", name: "tech-existing.md" }]), {
            headers: jsonHeaders,
          }),
        },
        {
          match: "update-by-file",
          response: new Response(JSON.stringify({}), { status: 200 }),
        },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });

    it("skips pages with empty content", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 30, path: "empty-page", updatedAt: futureDate }]),
                { headers: jsonHeaders },
              );
            }
            return new Response(wikiContentJson("  "), { headers: jsonHeaders });
          },
        },
        {
          match: "documents?",
          response: new Response(difyDocsJson([]), { headers: jsonHeaders }),
        },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.skipped).toBe(1);
    });

    it("records errors when Dify create fails", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 40, path: "fail-page", updatedAt: futureDate }]),
                { headers: jsonHeaders },
              );
            }
            return new Response(wikiContentJson("Some content"), { headers: jsonHeaders });
          },
        },
        {
          match: "documents?",
          response: new Response(difyDocsJson([]), { headers: jsonHeaders }),
        },
        {
          match: "create-by-file",
          response: new Response("Error", { status: 500 }),
        },
      ]);

      const result = await syncRecentChanges(999999);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Create failed");
    });
  });

  describe("syncWikiToDify", () => {
    it("creates, updates, and deletes documents", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([
                  { id: 1, path: "page-a", updatedAt: "2026-01-01T00:00:00Z" },
                  { id: 2, path: "page-b", updatedAt: "2026-01-01T00:00:00Z" },
                  { id: 3, path: "empty", updatedAt: "2026-01-01T00:00:00Z" },
                ]),
                { headers: jsonHeaders },
              );
            }
            if (graphqlCall === 2)
              return new Response(wikiContentJson("Content A"), { headers: jsonHeaders });
            if (graphqlCall === 3)
              return new Response(wikiContentJson("Content B"), { headers: jsonHeaders });
            return new Response(wikiContentJson("   "), { headers: jsonHeaders });
          },
        },
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

      const result = await syncWikiToDify();
      expect(result.updated).toBe(1);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.deleted).toBe(1);
    });

    it("uses targetDatasetId when provided", async () => {
      let capturedUrl = "";

      mockFetch([
        { match: "graphql", response: new Response(wikiPagesJson([]), { headers: jsonHeaders }) },
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

      await syncWikiToDify("custom-dataset-id");
      expect(capturedUrl).toContain("custom-dataset-id");
    });

    it("throws when dataset id is empty", async () => {
      await expect(syncWikiToDify("")).rejects.toThrow(
        "DIFY_DATASET_API_KEY and DIFY_DATASET_ID are required",
      );
    });

    it("handles update failure", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 1, path: "page-x", updatedAt: "2026-01-01T00:00:00Z" }]),
                { headers: jsonHeaders },
              );
            }
            return new Response(wikiContentJson("content"), { headers: jsonHeaders });
          },
        },
        {
          match: "documents?",
          response: new Response(difyDocsJson([{ id: "doc-x", name: "page-x.md" }]), {
            headers: jsonHeaders,
          }),
        },
        { match: "update-by-file", response: new Response("Error", { status: 500 }) },
      ]);

      const result = await syncWikiToDify();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Update failed");
    });

    it("handles delete failure", async () => {
      mockFetch([
        { match: "graphql", response: new Response(wikiPagesJson([]), { headers: jsonHeaders }) },
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

      const result = await syncWikiToDify();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Delete failed");
    });

    it("handles page content fetch error gracefully", async () => {
      let graphqlCall = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            graphqlCall++;
            return true;
          },
          response: () => {
            if (graphqlCall === 1) {
              return new Response(
                wikiPagesJson([{ id: 1, path: "err-page", updatedAt: "2026-01-01T00:00:00Z" }]),
                { headers: jsonHeaders },
              );
            }
            return new Response("Server Error", { status: 500 });
          },
        },
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
      ]);

      const result = await syncWikiToDify();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("err-page");
    });
  });

  describe("syncAllDatasets", () => {
    it("syncs default and project-specific datasets", async () => {
      mockFetch([
        { match: "graphql", response: new Response(wikiPagesJson([]), { headers: jsonHeaders }) },
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
      ]);

      const results = await syncAllDatasets();
      expect(results["default"]).toBeDefined();
      expect(results["proj-alpha"]).toBeDefined();
      expect(results["default"].errors.length).toBe(0);
      expect(results["proj-alpha"].errors.length).toBe(0);
    });

    it("captures errors per dataset without stopping others", async () => {
      let wikiCallCount = 0;

      mockFetch([
        {
          match: (url) => {
            if (!url.includes("graphql")) return false;
            wikiCallCount++;
            return true;
          },
          response: () => {
            // First Wiki.js call (default dataset) succeeds, second (proj-alpha) fails
            if (wikiCallCount <= 1) {
              return new Response(wikiPagesJson([]), { headers: jsonHeaders });
            }
            return new Response("Wiki.js Error", { status: 500 });
          },
        },
        { match: "documents?", response: new Response(difyDocsJson([]), { headers: jsonHeaders }) },
      ]);

      const results = await syncAllDatasets();
      expect(results["default"]).toBeDefined();
      expect(results["proj-alpha"]).toBeDefined();
      expect(results["proj-alpha"].errors.length).toBeGreaterThan(0);
    });
  });
});
