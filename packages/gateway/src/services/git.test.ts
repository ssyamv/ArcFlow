import { describe, expect, it, mock, beforeEach } from "bun:test";
import { join } from "path";
import * as realFs from "fs";

// Capture real fs functions before mock.module("fs") replaces the module bindings.
// bun updates the live namespace object when mock.module is called, so realFs.readFileSync
// would point to the mock after mock.module("fs") executes — causing infinite recursion.
const _realReadFileSync = realFs.readFileSync.bind(realFs);
const _realExistsSync = realFs.existsSync.bind(realFs);

// --- Mock simple-git ---
const gitMethods = {
  fetch: mock(() => Promise.resolve()),
  pull: mock(() => Promise.resolve()),
  clone: mock(() => Promise.resolve()),
  add: mock(() => Promise.resolve()),
  commit: mock(() => Promise.resolve()),
  push: mock(() => Promise.resolve()),
  checkoutLocalBranch: mock(() => Promise.resolve()),
  remote: mock(() => Promise.resolve("  HEAD branch: main\n")),
  status: mock(() => Promise.resolve({ isClean: () => true })),
  stash: mock(() => Promise.resolve()),
  addConfig: mock(() => Promise.resolve()),
};

mock.module("simple-git", () => ({
  default: () => gitMethods,
}));

// --- Mock fs (passthrough .sql files for db schema init, spread all real fs for other consumers) ---
let existsSyncReturn = false;
const mkdirSyncMock = mock(() => undefined);
const readFileSyncMock = mock((() => "file content") as (...args: unknown[]) => string);
const writeFileSyncMock = mock(() => undefined);
const readdirSyncMock = mock(() => [] as unknown[]);
const statSyncMock = mock(() => ({ isDirectory: () => false }));
const unlinkSyncMock = mock(() => undefined);
const renameSyncMock = mock(() => undefined);

mock.module("fs", () => ({
  ...realFs,
  existsSync: (path: string) => {
    if (typeof path === "string" && path.endsWith(".sql")) return _realExistsSync(path);
    return existsSyncReturn;
  },
  mkdirSync: mkdirSyncMock,
  readFileSync: (path: string, ...args: unknown[]) => {
    if (typeof path === "string" && path.endsWith(".sql"))
      return _realReadFileSync(path, ...(args as [BufferEncoding]));
    return readFileSyncMock(path, ...args);
  },
  writeFileSync: writeFileSyncMock,
  readdirSync: readdirSyncMock,
  statSync: statSyncMock,
  unlinkSync: unlinkSyncMock,
  renameSync: renameSyncMock,
  join,
  dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
}));

// --- Mock config ---
import { createTestConfig } from "../test-config";
mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      gitWorkDir: "/tmp/test-git",
      backendGitRepo: "git@example.com:org/backend.git",
      vue3GitRepo: "git@example.com:org/vue3.git",
      flutterGitRepo: "git@example.com:org/flutter.git",
      androidGitRepo: "git@example.com:org/android.git",
    }),
}));

// Import after mocks
const {
  ensureRepo,
  readFile,
  writeAndPush,
  createBranchAndPush,
  listTree,
  deleteFile,
  renameFile,
  searchFiles,
  registerRepoUrl,
} = await import("./git");

// "docs" 仓库已从全局 config 移除，测试用动态注册
registerRepoUrl("docs", "git@example.com:org/docs.git");

function clearAllMocks() {
  Object.values(gitMethods).forEach((m) => m.mockClear());
  mkdirSyncMock.mockClear();
  readFileSyncMock.mockClear();
  writeFileSyncMock.mockClear();
  readdirSyncMock.mockClear();
  statSyncMock.mockClear();
  unlinkSyncMock.mockClear();
  renameSyncMock.mockClear();
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

    expect(readFileSyncMock).toHaveBeenCalled();
    expect(result).toBe("prd content");
  });
});

describe("writeAndPush", () => {
  beforeEach(clearAllMocks);

  it("writes file, commits and pushes", async () => {
    await writeAndPush("docs", "tech-design/2026-04/feature.md", "content", "docs: add feature");

    expect(writeFileSyncMock).toHaveBeenCalled();
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

describe("listTree", () => {
  beforeEach(clearAllMocks);

  it("returns empty array for empty directory", async () => {
    existsSyncReturn = true;
    readdirSyncMock.mockReturnValue([]);
    const tree = await listTree("docs");
    expect(tree).toEqual([]);
  });
});

describe("deleteFile", () => {
  beforeEach(clearAllMocks);
  it("deletes file, commits and pushes", async () => {
    await deleteFile("docs", "prd/old.md", "docs: remove old prd");
    expect(gitMethods.add).toHaveBeenCalledWith("prd/old.md");
    expect(gitMethods.commit).toHaveBeenCalledWith("docs: remove old prd");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "main");
  });
});

describe("renameFile", () => {
  beforeEach(clearAllMocks);
  it("renames file, commits and pushes", async () => {
    await renameFile("docs", "prd/old.md", "prd/new.md", "docs: rename prd");
    expect(gitMethods.add).toHaveBeenCalledWith("-A");
    expect(gitMethods.commit).toHaveBeenCalledWith("docs: rename prd");
    expect(gitMethods.push).toHaveBeenCalledWith("origin", "main");
  });
});

describe("searchFiles", () => {
  beforeEach(clearAllMocks);
  it("returns matching results", async () => {
    existsSyncReturn = true;
    readdirSyncMock.mockReturnValue(["readme.md"]);
    statSyncMock.mockReturnValue({ isDirectory: () => false });
    readFileSyncMock.mockReturnValue("line1\nfoo bar keyword baz\nline3");
    const results = await searchFiles("docs", "keyword");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("readme.md");
    expect(results[0].matches[0]).toContain("keyword");
  });
});
