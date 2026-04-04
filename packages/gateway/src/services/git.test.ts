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
const { createBranchAndPush } = await import("./git");

describe("createBranchAndPush", () => {
  beforeEach(() => {
    gitMethods.add.mockClear();
    gitMethods.commit.mockClear();
    gitMethods.push.mockClear();
    gitMethods.checkoutLocalBranch.mockClear();
  });

  it("accepts 3 args (no files param) and stages all changes with git add -A", async () => {
    await createBranchAndPush("backend", "fix/bug-1", "fix: bug 1");

    // Should create the branch
    expect(gitMethods.checkoutLocalBranch).toHaveBeenCalledWith("fix/bug-1");

    // Should stage ALL changes with -A
    expect(gitMethods.add).toHaveBeenCalledWith("-A");

    // Should commit with the provided message
    expect(gitMethods.commit).toHaveBeenCalledWith("fix: bug 1");

    // Should push with --set-upstream
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
