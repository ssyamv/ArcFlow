import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock git service
const mockListTree = mock(() => Promise.resolve([]));
const mockReadFile = mock(() => Promise.resolve("# Test"));
const mockWriteAndPush = mock(() => Promise.resolve());
const mockDeleteFile = mock(() => Promise.resolve());
const mockRenameFile = mock(() => Promise.resolve());
const mockSearchFiles = mock(() => Promise.resolve([]));
const mockEnsureRepo = mock(() => Promise.resolve());

mock.module("../services/git", () => ({
  listTree: mockListTree,
  readFile: mockReadFile,
  writeAndPush: mockWriteAndPush,
  deleteFile: mockDeleteFile,
  renameFile: mockRenameFile,
  searchFiles: mockSearchFiles,
  ensureRepo: mockEnsureRepo,
}));

// Mock wikijs
const mockTriggerSync = mock(() => Promise.resolve());
mock.module("../services/wikijs", () => ({
  triggerSync: mockTriggerSync,
}));

// Import after mocks
const { docsRoutes } = await import("./docs");
import { Hono } from "hono";

const app = new Hono();
app.route("/api/docs", docsRoutes);

function clearAll() {
  mockListTree.mockClear();
  mockReadFile.mockClear();
  mockWriteAndPush.mockClear();
  mockDeleteFile.mockClear();
  mockRenameFile.mockClear();
  mockSearchFiles.mockClear();
  mockEnsureRepo.mockClear();
  mockTriggerSync.mockClear();
}

describe("GET /api/docs/tree", () => {
  beforeEach(clearAll);

  it("returns directory tree", async () => {
    mockListTree.mockResolvedValue([{ name: "prd", path: "prd", type: "directory", children: [] }]);
    const res = await app.request("/api/docs/tree");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].name).toBe("prd");
    expect(mockListTree).toHaveBeenCalledWith("docs");
  });
});

describe("GET /api/docs/file", () => {
  beforeEach(clearAll);

  it("returns file content", async () => {
    mockReadFile.mockResolvedValue("# Hello");
    const res = await app.request("/api/docs/file?path=prd/test.md");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("# Hello");
  });

  it("returns 400 when path is missing", async () => {
    const res = await app.request("/api/docs/file");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/docs/file", () => {
  beforeEach(clearAll);

  it("creates file and triggers sync", async () => {
    const res = await app.request("/api/docs/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prd/new.md", content: "# New" }),
    });
    expect(res.status).toBe(201);
    expect(mockWriteAndPush).toHaveBeenCalledWith(
      "docs",
      "prd/new.md",
      "# New",
      "docs: 新建 prd/new.md",
    );
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("PUT /api/docs/file", () => {
  beforeEach(clearAll);

  it("updates file and triggers sync", async () => {
    const res = await app.request("/api/docs/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prd/test.md", content: "# Updated" }),
    });
    expect(res.status).toBe(200);
    expect(mockWriteAndPush).toHaveBeenCalledWith(
      "docs",
      "prd/test.md",
      "# Updated",
      "docs: 更新 prd/test.md",
    );
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("DELETE /api/docs/file", () => {
  beforeEach(clearAll);

  it("deletes file and triggers sync", async () => {
    const res = await app.request("/api/docs/file?path=prd/old.md", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(mockDeleteFile).toHaveBeenCalledWith("docs", "prd/old.md", "docs: 删除 prd/old.md");
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("PUT /api/docs/rename", () => {
  beforeEach(clearAll);

  it("renames file and triggers sync", async () => {
    const res = await app.request("/api/docs/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: "prd/a.md", newPath: "prd/b.md" }),
    });
    expect(res.status).toBe(200);
    expect(mockRenameFile).toHaveBeenCalledWith(
      "docs",
      "prd/a.md",
      "prd/b.md",
      "docs: 重命名 prd/a.md → prd/b.md",
    );
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("POST /api/docs/folder", () => {
  beforeEach(clearAll);

  it("creates folder with .gitkeep", async () => {
    const res = await app.request("/api/docs/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new-folder" }),
    });
    expect(res.status).toBe(201);
    expect(mockWriteAndPush).toHaveBeenCalledWith(
      "docs",
      "new-folder/.gitkeep",
      "",
      "docs: 新建目录 new-folder",
    );
    expect(mockTriggerSync).toHaveBeenCalled();
  });
});

describe("GET /api/docs/search", () => {
  beforeEach(clearAll);

  it("returns search results", async () => {
    mockSearchFiles.mockResolvedValue([
      { path: "prd/test.md", name: "test.md", matches: ["keyword found"] },
    ]);
    const res = await app.request("/api/docs/search?q=keyword");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.request("/api/docs/search");
    expect(res.status).toBe(400);
  });
});
