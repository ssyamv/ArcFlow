import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createRagSearch } from "./rag-search";

if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      process.env.SQLITE_LIB_PATH ?? "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    );
  } catch {
    // already set
  }
}

function makeDb() {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE rag_chunk_meta (chunk_id TEXT PRIMARY KEY, workspace_id TEXT, doc_path TEXT, heading TEXT, content TEXT);
    CREATE VIRTUAL TABLE rag_chunks USING vec0(chunk_id TEXT PRIMARY KEY, workspace_id TEXT PARTITION KEY, embedding FLOAT[4]);
  `);
  return db;
}

describe("rag-search", () => {
  it("returns top_k chunks ordered by similarity within workspace", async () => {
    const db = makeDb();
    const insert = (id: string, ws: string, e: number[], heading: string) => {
      db.run(`INSERT INTO rag_chunk_meta VALUES(?,?,?,?,?)`, [
        id,
        ws,
        "a.md",
        heading,
        `content-${id}`,
      ]);
      db.run(`INSERT INTO rag_chunks(chunk_id, workspace_id, embedding) VALUES(?,?,?)`, [
        id,
        ws,
        new Float32Array(e),
      ]);
    };
    insert("c1", "w1", [1, 0, 0, 0], "H1");
    insert("c2", "w1", [0.9, 0.1, 0, 0], "H2");
    insert("c3", "w1", [0, 1, 0, 0], "H3");
    insert("c4", "w2", [1, 0, 0, 0], "H4"); // other workspace

    const embedder = { embedBatch: async () => [[1, 0, 0, 0]] };
    const search = createRagSearch({ db, embedder });

    const out = await search.search({ workspaceId: "w1", query: "q", topK: 2 });
    expect(out.length).toBe(2);
    expect(out[0].heading).toBe("H1");
    expect(out.every((c) => c.docPath === "a.md")).toBe(true);
  });

  it("rejects empty workspaceId", async () => {
    const db = makeDb();
    const embedder = { embedBatch: async () => [[1, 0, 0, 0]] };
    const search = createRagSearch({ db, embedder });
    await expect(search.search({ workspaceId: "", query: "q", topK: 3 })).rejects.toThrow(
      /workspaceId/,
    );
  });
});
