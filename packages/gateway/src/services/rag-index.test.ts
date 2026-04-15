import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { splitMarkdown, createRagIndex } from "./rag-index";

// Bun's bundled SQLite disables extension loading; point to system SQLite with extension support.
if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      process.env.SQLITE_LIB_PATH ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    );
  } catch {
    // Already set in another test file
  }
}

function makeDb(dim: number) {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE rag_docs (workspace_id TEXT, doc_path TEXT, git_sha TEXT, indexed_at INTEGER,
      PRIMARY KEY (workspace_id, doc_path));
    CREATE TABLE rag_chunk_meta (chunk_id TEXT PRIMARY KEY, workspace_id TEXT, doc_path TEXT, heading TEXT, content TEXT);
    CREATE VIRTUAL TABLE rag_chunks USING vec0(chunk_id TEXT PRIMARY KEY, workspace_id TEXT PARTITION KEY, embedding FLOAT[${dim}]);
  `);
  return db;
}

describe("splitMarkdown", () => {
  it("splits by h1/h2/h3 headings", () => {
    const md = `# A\ntext1\n## B\ntext2\n# C\ntext3`;
    const chunks = splitMarkdown(md, { maxTokens: 1000 });
    expect(chunks.map((c) => c.heading)).toEqual(["A", "A > B", "C"]);
  });

  it("splits a long section into sub-chunks under token cap", () => {
    const long = "word ".repeat(2000);
    const md = `# H\n${long}`;
    const chunks = splitMarkdown(md, { maxTokens: 800 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(800 * 4 + 50));
  });

  it("includes heading ancestry in heading field", () => {
    const md = `# A\n## B\n### C\ntext`;
    const chunks = splitMarkdown(md, { maxTokens: 1000 });
    expect(chunks[chunks.length - 1].heading).toBe("A > B > C");
  });
});

describe("createRagIndex.upsertDoc", () => {
  it("inserts chunks with embeddings and meta", async () => {
    const db = makeDb(4);
    const embedder = {
      embedBatch: async (xs: string[]) => xs.map((_, i) => [i, 0, 0, 0]),
    };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.upsertDoc({
      workspaceId: "w1",
      docPath: "a.md",
      gitSha: "sha1",
      content: `# H\nhello world`,
    });
    const rows = db.prepare("SELECT COUNT(*) as n FROM rag_chunk_meta").all() as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("replaces chunks on re-upsert (new git_sha)", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1, 0, 0, 0]) };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.upsertDoc({ workspaceId: "w1", docPath: "a.md", gitSha: "s1", content: `# H1\nA` });
    await idx.upsertDoc({
      workspaceId: "w1",
      docPath: "a.md",
      gitSha: "s2",
      content: `# H2\nB\n# H3\nC`,
    });
    const metas = db
      .prepare("SELECT heading FROM rag_chunk_meta WHERE doc_path='a.md' ORDER BY heading")
      .all();
    expect(metas.length).toBe(2);
  });

  it("deleteDoc removes chunks and doc row", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1, 0, 0, 0]) };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.upsertDoc({ workspaceId: "w1", docPath: "a.md", gitSha: "s1", content: "# X\nA" });
    await idx.deleteDoc({ workspaceId: "w1", docPath: "a.md" });
    const metas = db.prepare("SELECT * FROM rag_chunk_meta").all();
    const docs = db.prepare("SELECT * FROM rag_docs").all();
    expect(metas.length).toBe(0);
    expect(docs.length).toBe(0);
  });

  it("rejects empty workspaceId", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async () => [[1, 0, 0, 0]] };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await expect(
      idx.upsertDoc({ workspaceId: "", docPath: "a.md", gitSha: "s", content: "# H\nx" }),
    ).rejects.toThrow(/workspaceId/);
  });
});

describe("syncAll", () => {
  it("adds new, updates changed, removes missing", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1, 0, 0, 0]) };

    const gitState = {
      files: new Map<string, { sha: string; content: string }>([
        ["a.md", { sha: "s1", content: "# A\nx" }],
        ["b.md", { sha: "s1", content: "# B\ny" }],
      ]),
    };
    const gitAdapter = {
      listDocs: async () => Array.from(gitState.files, ([path, v]) => ({ path, sha: v.sha })),
      readDoc: async (p: string) => gitState.files.get(p)!.content,
    };

    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.syncAll({ workspaceId: "w1", git: gitAdapter });

    expect((db.prepare("SELECT COUNT(*) as n FROM rag_docs").get() as { n: number }).n).toBe(2);

    gitState.files.delete("b.md");
    gitState.files.set("a.md", { sha: "s2", content: "# A2\nz" });
    gitState.files.set("c.md", { sha: "s1", content: "# C\nq" });

    await idx.syncAll({ workspaceId: "w1", git: gitAdapter });

    const paths = (
      db.prepare("SELECT doc_path FROM rag_docs ORDER BY doc_path").all() as {
        doc_path: string;
      }[]
    ).map((r) => r.doc_path);
    expect(paths).toEqual(["a.md", "c.md"]);
    const aSha = (
      db.prepare("SELECT git_sha FROM rag_docs WHERE doc_path='a.md'").get() as {
        git_sha: string;
      }
    ).git_sha;
    expect(aSha).toBe("s2");
  });
});
