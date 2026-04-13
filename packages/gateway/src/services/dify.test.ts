import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { createTestConfig } from "../test-config";

// Mock config to avoid env var masking in CI
mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      difyBaseUrl: "http://dify-test:3001",
      difyApiKey: "dify-shared-val",
      difyTechDocApiKey: "dify-techdoc-val",
      difyOpenApiApiKey: "dify-openapi-val",
      difyBugAnalysisApiKey: "dify-bugfix-val",
      difyRagApiKey: "dify-rag-val",
      difyDatasetMap: {
        "proj-alpha": { datasetId: "ds-alpha", ragApiKey: "rag-alpha-key" },
        "proj-beta": { datasetId: "ds-beta" },
      },
    }),
}));

const { generateTechDoc, generateOpenApi, analyzeBug, queryKnowledgeBase } = await import("./dify");

function makeDifyResponse(output: string) {
  return new Response(
    JSON.stringify({
      data: {
        id: "run-1",
        workflow_id: "wf-1",
        status: "succeeded",
        outputs: { result: output },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

function skipRetryDelays() {
  // @ts-expect-error - mock setTimeout to execute callback immediately
  globalThis.setTimeout = (fn: () => void) => {
    fn();
    return 0;
  };
}

describe("dify service", () => {
  let capturedHeaders: Record<string, string>;

  beforeEach(() => {
    capturedHeaders = {};
    const fn = async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return makeDifyResponse("generated content");
    };
    globalThis.fetch = fn as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  it("generateTechDoc uses difyTechDocApiKey", async () => {
    const result = await generateTechDoc("prd content");
    expect(capturedHeaders["Authorization"]).toBe("Bearer dify-techdoc-val");
    expect(result).toBe("generated content");
  });

  it("generateOpenApi uses difyOpenApiApiKey", async () => {
    const result = await generateOpenApi("tech doc content");
    expect(capturedHeaders["Authorization"]).toBe("Bearer dify-openapi-val");
    expect(result).toBe("generated content");
  });

  it("analyzeBug uses difyBugAnalysisApiKey", async () => {
    const result = await analyzeBug("ci log", "context");
    expect(capturedHeaders["Authorization"]).toBe("Bearer dify-bugfix-val");
    expect(result).toBe("generated content");
  });

  it("throws on HTTP error response", async () => {
    skipRetryDelays();
    globalThis.fetch = (async () =>
      new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;

    await expect(generateTechDoc("prd")).rejects.toThrow("Dify API error: 500");
  });

  it("throws when workflow status is not succeeded", async () => {
    skipRetryDelays();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: "run-1",
            workflow_id: "wf-1",
            status: "failed",
            outputs: {},
            error: "model timeout",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(generateTechDoc("prd")).rejects.toThrow("Dify workflow failed: model timeout");
  });

  it("retries on failure before throwing", async () => {
    skipRetryDelays();
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      throw new Error("network error");
    }) as unknown as typeof fetch;

    await expect(generateTechDoc("prd")).rejects.toThrow("network error");
    expect(callCount).toBe(3); // initial + 2 retries
  });

  it("queryKnowledgeBase uses difyRagApiKey and calls /v1/chat-messages", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ answer: "knowledge answer", conversation_id: "conv-123" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await queryKnowledgeBase("what is ArcFlow?");
    expect(capturedUrl).toBe("http://dify-test:3001/v1/chat-messages");
    expect(capturedHeaders["Authorization"]).toBe("Bearer dify-rag-val");
    expect(capturedBody.response_mode).toBe("blocking");
    expect(capturedBody.user).toBe("gateway-rag");
    expect(result.answer).toBe("knowledge answer");
    expect(result.conversation_id).toBe("conv-123");
  });

  it("queryKnowledgeBase passes conversation_id for multi-turn", async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ answer: "follow-up answer", conversation_id: "conv-123" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await queryKnowledgeBase("tell me more", "conv-123");
    expect(capturedBody.conversation_id).toBe("conv-123");
  });

  it("queryKnowledgeBase throws on HTTP error", async () => {
    globalThis.fetch = (async () =>
      new Response("Bad Request", { status: 400 })) as unknown as typeof fetch;

    await expect(queryKnowledgeBase("bad query")).rejects.toThrow("Dify RAG API error: 400");
  });

  it("queryKnowledgeBase uses project-specific ragApiKey when projectId provided", async () => {
    let capturedAuth = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      capturedAuth = headers["Authorization"];
      return new Response(
        JSON.stringify({ answer: "project answer", conversation_id: "conv-p1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await queryKnowledgeBase("project question", undefined, "proj-alpha");
    expect(capturedAuth).toBe("Bearer rag-alpha-key");
    expect(result.answer).toBe("project answer");
  });

  it("queryKnowledgeBase falls back to default ragApiKey for unknown project", async () => {
    let capturedAuth = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      capturedAuth = headers["Authorization"];
      return new Response(
        JSON.stringify({ answer: "default answer", conversation_id: "conv-d1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await queryKnowledgeBase("question", undefined, "unknown-project");
    expect(capturedAuth).toBe("Bearer dify-rag-val");
  });

  it("queryKnowledgeBase falls back to default when project has no ragApiKey", async () => {
    let capturedAuth = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      capturedAuth = headers["Authorization"];
      return new Response(JSON.stringify({ answer: "beta answer", conversation_id: "conv-b1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await queryKnowledgeBase("question", undefined, "proj-beta");
    expect(capturedAuth).toBe("Bearer dify-rag-val");
  });
});
