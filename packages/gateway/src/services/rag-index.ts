import { Database } from "bun:sqlite";
import type { EmbeddingClient } from "./llm-embedding";

export interface Chunk {
  heading: string;
  content: string;
}
export interface SplitOptions {
  maxTokens: number;
}

// 粗估：1 token ≈ 4 chars（足够用于上限切分）
const CHAR_PER_TOKEN = 4;

export function splitMarkdown(md: string, opts: SplitOptions): Chunk[] {
  const maxChars = opts.maxTokens * CHAR_PER_TOKEN;
  const lines = md.split("\n");
  const stack: string[] = [];
  const sections: { heading: string; content: string[] }[] = [];

  let current: { heading: string; content: string[] } | null = null;

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      const level = m[1].length;
      const title = m[2].trim();
      stack.length = level - 1;
      stack[level - 1] = title;
      current = { heading: stack.filter(Boolean).join(" > "), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const body = s.content.join("\n").trim();
    if (!body) continue;
    if (body.length <= maxChars) {
      chunks.push({ heading: s.heading, content: body });
    } else {
      for (let i = 0; i < body.length; i += maxChars) {
        chunks.push({ heading: s.heading, content: body.slice(i, i + maxChars) });
      }
    }
  }
  return chunks;
}

export interface RagIndexDeps {
  db: Database;
  embedder: Pick<EmbeddingClient, "embedBatch">;
  dim: number;
}

export interface UpsertDocInput {
  workspaceId: string;
  docPath: string;
  gitSha: string;
  content: string;
}

export function createRagIndex(deps: RagIndexDeps) {
  const { db, embedder } = deps;

  function assertWorkspace(ws: string) {
    if (!ws) throw new Error("workspaceId required");
  }

  function chunkId(ws: string, path: string, i: number) {
    return `${ws}:${path}#${i}`;
  }

  async function upsertDoc(input: UpsertDocInput) {
    assertWorkspace(input.workspaceId);
    const chunks = splitMarkdown(input.content, { maxTokens: 800 });
    const embeddings = chunks.length
      ? await embedder.embedBatch(chunks.map((c) => `${c.heading}\n${c.content}`))
      : [];

    const tx = db.transaction(() => {
      db.run(`DELETE FROM rag_chunk_meta WHERE workspace_id=? AND doc_path=?`, [
        input.workspaceId,
        input.docPath,
      ]);
      db.run(`DELETE FROM rag_chunks WHERE workspace_id=? AND chunk_id LIKE ?`, [
        input.workspaceId,
        `${input.workspaceId}:${input.docPath}#%`,
      ]);
      chunks.forEach((c, i) => {
        const id = chunkId(input.workspaceId, input.docPath, i);
        db.run(
          `INSERT INTO rag_chunk_meta(chunk_id, workspace_id, doc_path, heading, content) VALUES(?,?,?,?,?)`,
          [id, input.workspaceId, input.docPath, c.heading, c.content],
        );
        db.run(`INSERT INTO rag_chunks(chunk_id, workspace_id, embedding) VALUES(?,?,?)`, [
          id,
          input.workspaceId,
          new Float32Array(embeddings[i]),
        ]);
      });
      db.run(
        `INSERT OR REPLACE INTO rag_docs(workspace_id, doc_path, git_sha, indexed_at) VALUES(?,?,?,?)`,
        [input.workspaceId, input.docPath, input.gitSha, Date.now()],
      );
    });
    tx();
  }

  function deleteDoc(input: { workspaceId: string; docPath: string }) {
    assertWorkspace(input.workspaceId);
    const tx = db.transaction(() => {
      db.run(`DELETE FROM rag_chunk_meta WHERE workspace_id=? AND doc_path=?`, [
        input.workspaceId,
        input.docPath,
      ]);
      db.run(`DELETE FROM rag_chunks WHERE workspace_id=? AND chunk_id LIKE ?`, [
        input.workspaceId,
        `${input.workspaceId}:${input.docPath}#%`,
      ]);
      db.run(`DELETE FROM rag_docs WHERE workspace_id=? AND doc_path=?`, [
        input.workspaceId,
        input.docPath,
      ]);
    });
    tx();
  }

  return { upsertDoc, deleteDoc };
}
