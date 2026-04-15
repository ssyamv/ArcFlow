import { Database } from "bun:sqlite";
import type { EmbeddingClient } from "./llm-embedding";

export interface SearchDeps {
  db: Database;
  embedder: Pick<EmbeddingClient, "embedBatch">;
}

export interface SearchInput {
  workspaceId: string;
  query: string;
  topK: number;
}

export interface SearchChunk {
  docPath: string;
  heading: string;
  content: string;
  score: number;
}

export function createRagSearch({ db, embedder }: SearchDeps) {
  return {
    async search(input: SearchInput): Promise<SearchChunk[]> {
      if (!input.workspaceId) throw new Error("workspaceId required");
      const [q] = await embedder.embedBatch([input.query]);
      const rows = db
        .prepare(
          `
        SELECT m.doc_path as doc_path, m.heading as heading, m.content as content, v.distance as distance
        FROM rag_chunks v
        JOIN rag_chunk_meta m ON m.chunk_id = v.chunk_id
        WHERE v.workspace_id = ? AND v.embedding MATCH ? AND k = ?
        ORDER BY v.distance ASC
      `,
        )
        .all(input.workspaceId, new Float32Array(q), input.topK) as {
        doc_path: string;
        heading: string;
        content: string;
        distance: number;
      }[];
      return rows.map((r) => ({
        docPath: r.doc_path,
        heading: r.heading,
        content: r.content,
        score: 1 - r.distance,
      }));
    },
  };
}
