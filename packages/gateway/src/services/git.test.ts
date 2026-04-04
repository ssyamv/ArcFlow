import { describe, expect, it, mock, beforeEach } from "bun:test";

// --- Mock simple-git ---
const gitMethods = {
  fetch: mock(() => Promise.resolve()),
  pull: mock(() => Promise.resolve()),
  clone: mock(() => Promise.resolve()),
  add: mock(() => Promise.resolve()),
  commit: mock(() => Promise.resolve()),
  push: mock(() => Promise.resolve()),
  checkoutLocalBranch: mock(() => Promise.resolve()),
};

mock.module("simple-git", () => ({
  default: () => gitMethods,
}));

// --- Mock fs ---
let existsSyncReturn = false;
const mkdirSyncMock = mock(() => undefined);
const readFileSyncMock = mock((() => "file content") as () => string);
const writeFileSyncMock = mock(() => undefined);

mock.module("fs", () => ({
  existsSync: () => existsSyncReturn,
  mkdirSync: mkdirSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
}));

// --- Mock config ---
mock.module("../config", () => ({
  getConfig: () => ({
    gitWorkDir: "/tmp/test-git",
    docsGitRepo: "git@example.com:org/docs.git",
    backendGitRepo: "git@example.com:org/backend.git",
    vue3GitRepo: "git@example.com:org/vue3.git",
    flutterGitRepo: "git@example.com:org/flutter.git",
    androidGitRepo: "git@example.com:org/android.git",
  }),
}));

// Import after mocks
const { ensureRepo, readFile, writeAndPush, createBranchAndPush } = await import("./git");

function clearAllMocks() {
  Object.values(gitMethods).forEach((m) => m.mockClear());
  mkdirSyncMock.mockClear();
  readFileSyncMock.mockClear();
  writeFileSyncMock.mockClear();
}

describe("ensureRepo", () => {
  beforeEach(clearAllMocks);

  it("clones repo when .git directory does not exist", async () => {
    existsSyncReturn = false;
    await ensureRepo("docs");

    expect(gitMethods.clone).toHaveBeenCalledWith(
      "git@example.com:org/docs.git",
      "/tmp/test-git/docs",
    );
  });

  it("fetches and pulls when repo already exists", async () => {
    existsSyncReturn = true;
    await ensureRepo("backend");

    expect(gitMethods.fetch).toHaveBeenCalledTimes(1);
    expect(gitMethods.pull).toHaveBeenCalledWith("origin", "main", { "--rebase": null });
    expect(gitMethods.clone).not.toHaveBeenCalled();
  });

  it("throws for unknown repo name", async () => {
    existsSyncReturn = false;
    expect(ensureRepo("unknown-repo")).rejects.toThrow("Unknown repo: unknown-repo");
  });
});

describe("readFile", () => {
  beforeEach(clearAllMocks);

  it("reads file from correct path", async () => {
    readFileSyncMock.mockReturnValue("prd content");
    const result = await readFile("docs", "prd/feature-x.md");

    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/test-git/docs/prd/feature-x.md", "utf-8");
    expect(result).toBe("prd content");
  });
});

describe("writeAndPush", () => {
  beforeEach(clearAllMocks);

  it("writes file, commits and pushes", async () => {
    await writeAndPush("docs", "tech-design/2026-04/feature.md", "content", "docs: add feature");

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      "/tmp/test-git/docs/tech-design/2026-04/feature.md",
      "content",
      "utf-8",
    );
    expect(gitMethods.add).toHaveBeenCalledWith("tech-design/2026-04/feature.md");
    expect(gitMethods.commit).toHaveBeenCalledWith("docs: add feature");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "main");
  });

  it("retries with pull --rebase when push fails", async () => {
    let pushCallCount = 0;
    gitMethods.push.mockImplementation(() => {
      pushCallCount++;
      if (pushCallCount === 1) return Promise.reject(new Error("push rejected"));
      return Promise.resolve();
    });

    await writeAndPush("docs", "api/file.yaml", "openapi", "docs: add api");

    expect(gitMethods.pull).toHaveBeenCalledWith("origin", "main", { "--rebase": null });
    expect(gitMethods.push).toHaveBeenCalledTimes(2);
  });
});

describe("createBranchAndPush", () => {
  beforeEach(clearAllMocks);

  it("stages all changes with git add -A", async () => {
    await createBranchAndPush("backend", "fix/bug-1", "fix: bug 1");

    expect(gitMethods.checkoutLocalBranch).toHaveBeenCalledWith("fix/bug-1");
    expect(gitMethods.add).toHaveBeenCalledWith("-A");
    expect(gitMethods.commit).toHaveBeenCalledWith("fix: bug 1");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "fix/bug-1", {
      "--set-upstream": null,
    });
  });

  it("calls git operations in correct order", async () => {
    const callOrder: string[] = [];
    gitMethods.checkoutLocalBranch.mockImplementation(() => {
      callOrder.push("checkoutLocalBranch");
      return Promise.resolve();
    });
    gitMethods.add.mockImplementation(() => {
      callOrder.push("add");
      return Promise.resolve();
    });
    gitMethods.commit.mockImplementation(() => {
      callOrder.push("commit");
      return Promise.resolve();
    });
    gitMethods.push.mockImplementation(() => {
      callOrder.push("push");
      return Promise.resolve();
    });

    await createBranchAndPush("backend", "feature/test", "feat: test");

    expect(callOrder).toEqual(["checkoutLocalBranch", "add", "commit", "push"]);
  });
});
