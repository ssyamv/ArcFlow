import { describe, expect, it, mock, beforeEach } from "bun:test";

const getBuildDetail = mock(() =>
  Promise.resolve({
    uuid: "abc",
    buildSid: "1001",
    branch: "feat/PROJ-123",
    commitNum: "a19b",
    executor: "u1",
    executorName: "User",
    executeTime: "2026-04-06",
    duration: "60000",
    status: "FAIL",
    logUrl: "/ClientAppLog?uuid=abc-123",
    modules: [
      { moduleId: "1", modulekey: "Maven", status: "FAIL" },
      { moduleId: "2", modulekey: "GitCheckout", status: "SUCCEED" },
    ],
  }),
);
const getBuildLog = mock(() => Promise.resolve("Error: compilation failed at Foo.java:42"));
const getFailedModules = mock(() => ["Maven"]);

mock.module("./ibuild", () => ({
  getBuildDetail,
  getBuildLog,
  getFailedModules,
}));

describe("fetchBuildLogWithContext", () => {
  beforeEach(() => {
    getBuildDetail.mockClear();
    getBuildLog.mockClear();
    getFailedModules.mockClear();
  });

  it("fetches detail, extracts failed modules, and prepends context to log", async () => {
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");
    const result = await fetchBuildLogWithContext("proj-1", "app-1", "1001");

    expect(getBuildDetail).toHaveBeenCalledWith("proj-1", "app-1", "1001");
    expect(result).toContain("失败构建模块：Maven");
    expect(result).toContain("Error: compilation failed");
  });

  it("returns log without module prefix when no modules fail", async () => {
    getFailedModules.mockReturnValueOnce([]);
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");
    const result = await fetchBuildLogWithContext("proj-1", "app-1", "1001");

    expect(result).not.toContain("失败构建模块");
    expect(result).toContain("Error: compilation failed");
  });

  it("throws when log fetch fails", async () => {
    getBuildLog.mockRejectedValueOnce(new Error("log fetch failed"));
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");

    await expect(fetchBuildLogWithContext("proj-1", "app-1", "1001")).rejects.toThrow(
      "log fetch failed",
    );
  });

  it("throws when build has no logUrl", async () => {
    getBuildDetail.mockResolvedValueOnce({
      uuid: "abc",
      buildSid: "1001",
      branch: "master",
      commitNum: "x",
      executor: "u",
      executorName: "U",
      executeTime: "2026",
      duration: "0",
      status: "FAIL",
      modules: null,
      logUrl: undefined,
    });
    const { fetchBuildLogWithContext } = await import("./ibuild-log-fetcher");

    await expect(fetchBuildLogWithContext("proj-1", "app-1", "1001")).rejects.toThrow("no logUrl");
  });
});
