import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

// Mock config to avoid env var masking in CI
mock.module("../config", () => ({
  getConfig: () => ({
    difyBaseUrl: "http://dify-test:3001",
    difyApiKey: "dify-shared-val",
    difyTechDocApiKey: "dify-techdoc-val",
    difyOpenApiApiKey: "dify-openapi-val",
    difyBugAnalysisApiKey: "dify-bugfix-val",
  }),
}));

const { generateTechDoc, generateOpenApi, analyzeBug } = await import("./dify");

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

describe("dify service", () => {
  const originalFetch = globalThis.fetch;
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
});
