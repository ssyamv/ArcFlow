import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const getWorkspace = mock(() => ({
  id: 12,
  name: "Workspace",
  slug: "workspace",
  plane_project_id: "proj-7",
  plane_workspace_slug: "plane-ws",
  wiki_path_prefix: null,
  git_repos: JSON.stringify({ docs: "git@ex:docs.git" }),
  feishu_chat_id: null,
  created_at: "",
  updated_at: "",
}));

mock.module("../db/queries", () => ({
  getWorkspace,
}));

const registerRepoUrl = mock(() => {});
const ensureRepo = mock(async () => undefined);
const writeAndPush = mock(async () => undefined);

mock.module("./git", () => ({
  registerRepoUrl,
  ensureRepo,
  writeAndPush,
}));

const { createWorkflowWritebackService } = await import("./workflow-writeback");

describe("workflow writeback service", () => {
  beforeEach(() => {
    getWorkspace.mockClear();
    registerRepoUrl.mockClear();
    ensureRepo.mockClear();
    writeAndPush.mockClear();
  });

  afterEach(() => {
    getWorkspace.mockClear();
    registerRepoUrl.mockClear();
    ensureRepo.mockClear();
    writeAndPush.mockClear();
  });

  it("writes generated docs into the workspace docs repo", async () => {
    const service = createWorkflowWritebackService();

    await service.writeDoc({
      workspaceId: 12,
      relativePath: "tech/design.md",
      content: "# Design\nbody",
    });

    expect(getWorkspace).toHaveBeenCalledWith(12);
    expect(registerRepoUrl).toHaveBeenCalledWith("ws-12-docs", "git@ex:docs.git");
    expect(ensureRepo).toHaveBeenCalledWith("ws-12-docs");
    expect(writeAndPush).toHaveBeenCalledWith(
      "ws-12-docs",
      "tech/design.md",
      "# Design\nbody",
      "docs: write tech/design.md",
    );
  });

  it("fails fast when relativePath is missing", async () => {
    const service = createWorkflowWritebackService();

    await expect(
      // @ts-expect-error - deliberate legacy payload shape
      service.writeDoc({ workspaceId: 12, content: "body" }),
    ).rejects.toThrow("relativePath is required");

    expect(getWorkspace).not.toHaveBeenCalled();
    expect(registerRepoUrl).not.toHaveBeenCalled();
    expect(ensureRepo).not.toHaveBeenCalled();
    expect(writeAndPush).not.toHaveBeenCalled();
  });
});
