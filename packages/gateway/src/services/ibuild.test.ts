import { describe, expect, it, mock, afterEach } from "bun:test";

// Mock config to avoid env var masking in CI
mock.module("../config", () => ({
  getConfig: () => ({
    ibuildBaseUrl: "http://ibuild-test:8080",
    ibuildClientKey: "test-client-key",
    ibuildUser: "test-user",
  }),
}));

const {
  getAccessToken,
  getBuildDetail,
  getBuildLog,
  getFailedModules,
  extractIssueIdFromBranch,
  _resetTokenCache,
} = await import("./ibuild");

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

// ─── Task 3: Build Detail + Log Fetching + Failed Modules ─────────────────────

describe("getBuildDetail", () => {
  it("fetches build detail successfully", async () => {
    const mockDetail = {
      uuid: "uuid-1",
      buildSid: "build-sid-1",
      branch: "feat/PROJ-123",
      commitNum: "abc123",
      executor: "user1",
      executorName: "User One",
      executeTime: "2026-04-06T10:00:00Z",
      duration: "120",
      status: "SUCCESS",
      modules: [
        { moduleId: "mod-1", modulekey: "backend", status: "SUCCESS" },
        { moduleId: "mod-2", modulekey: "frontend", status: "FAIL" },
      ],
      logUrl: "/logs/build-sid-1.log",
    };

    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // Token request
        return new Response(JSON.stringify({ token: "cached-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Build detail request
      return new Response(JSON.stringify({ resCode: "0", obj: mockDetail }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    const detail = await getBuildDetail("proj-1", "app-1", "build-sid-1");
    expect(detail.buildSid).toBe("build-sid-1");
    expect(detail.status).toBe("SUCCESS");
    expect(detail.modules).toHaveLength(2);
  });

  it("throws when obj is null", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ token: "cached-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ resCode: "404", obj: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    await expect(getBuildDetail("proj-1", "app-1", "missing-sid")).rejects.toThrow(
      "Build missing-sid not found",
    );
  });
});

describe("getBuildLog", () => {
  it("fetches build log via logUrl", async () => {
    const logContent = "Build log line 1\nBuild log line 2\n";

    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ token: "cached-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(logContent, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    const log = await getBuildLog("/logs/build-sid-1.log");
    expect(log).toBe(logContent);
  });

  it("truncates logs larger than 100KB with prefix", async () => {
    // Create a log that is 150KB
    const largeLog = "x".repeat(150 * 1024);

    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ token: "cached-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(largeLog, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }) as unknown as typeof fetch;

    _resetTokenCache();

    const log = await getBuildLog("/logs/large-build.log");
    expect(log).toContain("[日志已截断，仅保留最后 100KB]");
    // The final log should be the prefix + newline + last 100KB
    const MAX_LOG_SIZE = 100 * 1024;
    const expectedSuffix = largeLog.slice(-MAX_LOG_SIZE);
    expect(log).toContain(expectedSuffix);
    // The total length should be prefix length + 1 (newline) + 100KB
    const prefix = "[日志已截断，仅保留最后 100KB]\n";
    expect(log.length).toBe(prefix.length + MAX_LOG_SIZE);
  });
});

describe("getFailedModules", () => {
  it("extracts modulekeys for FAIL status modules", () => {
    const modules = [
      { moduleId: "m1", modulekey: "backend", status: "SUCCESS" },
      { moduleId: "m2", modulekey: "frontend", status: "FAIL" },
      { moduleId: "m3", modulekey: "mobile", status: "FAIL" },
    ];
    const failed = getFailedModules(modules);
    expect(failed).toEqual(["frontend", "mobile"]);
  });

  it("returns empty array for empty modules list", () => {
    expect(getFailedModules([])).toEqual([]);
  });

  it("returns empty array when modules is null", () => {
    expect(getFailedModules(null)).toEqual([]);
  });
});

// ─── Task 4: Branch → Plane Issue ID Extraction ───────────────────────────────

describe("extractIssueIdFromBranch", () => {
  it("extracts issue ID from feat/ branch", () => {
    expect(extractIssueIdFromBranch("feat/PROJ-123-add-login")).toBe("PROJ-123");
  });

  it("extracts issue ID from fix/ branch", () => {
    expect(extractIssueIdFromBranch("fix/PROJ-456-fix-crash")).toBe("PROJ-456");
  });

  it("extracts issue ID from hotfix/ branch", () => {
    expect(extractIssueIdFromBranch("hotfix/PROJ-789-urgent-patch")).toBe("PROJ-789");
  });

  it("extracts issue ID from feature/ branch", () => {
    expect(extractIssueIdFromBranch("feature/BUG-42")).toBe("BUG-42");
  });

  it("returns null for master", () => {
    expect(extractIssueIdFromBranch("master")).toBeNull();
  });

  it("returns null for develop", () => {
    expect(extractIssueIdFromBranch("develop")).toBeNull();
  });

  it("returns null for release branch", () => {
    expect(extractIssueIdFromBranch("release/v1.0")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractIssueIdFromBranch("")).toBeNull();
  });
});
