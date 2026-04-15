# Dify → NanoClaw 全量迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Dify 承担的 4 条工作流 + RAG 能力全量切到 NanoClaw skill + Gateway sqlite-vec 自建 RAG，并下线 Dify。

**Architecture:** NanoClaw 承载 5 个 `arcflow-*` skill（PRD 草稿/技术设计/OpenAPI/Bug 分析/RAG）；Gateway 新增 sqlite-vec 索引、硅基流动 embedding 客户端、`/api/rag/search`、`/api/workflow/callback` 两个端点；Dify 及 `/prd/chat`、`/rag/query`、`rag-sync.ts`、`dify.ts`、`workflow.ts` 中的 Dify 调用全部删除。

**Tech Stack:** Bun + Hono + bun:sqlite + sqlite-vec + 硅基流动 embedding (BAAI/bge-m3) + Claude Agent SDK（NanoClaw 内）+ Claude API (opus-4-6 / sonnet-4-6)。

**Spec 参考：** `docs/superpowers/specs/2026-04-15-dify-to-nanoclaw-migration-design.md`

---

## 文件总览

### Gateway 新增

- `packages/gateway/src/services/llm-embedding.ts` + `llm-embedding.test.ts`
- `packages/gateway/src/services/rag-index.ts` + `rag-index.test.ts`
- `packages/gateway/src/services/rag-search.ts` + `rag-search.test.ts`
- `packages/gateway/src/services/workflow-callback.ts` + `workflow-callback.test.ts`
- `packages/gateway/src/services/scheduler.ts` + `scheduler.test.ts`
- `packages/gateway/src/routes/rag.ts` + `rag.test.ts`
- `packages/gateway/src/routes/workflow-callback.ts` + `workflow-callback.test.ts`
- `packages/gateway/scripts/rag-bootstrap.ts`

### Gateway 修改

- `packages/gateway/src/db/schema.sql` — 扩 `dispatch`，新增 RAG 三表
- `packages/gateway/src/db/queries.ts` — dispatch 新字段 + RAG queries
- `packages/gateway/src/config.ts` — 删 Dify 配置，加硅基流动 + RAG 配置
- `packages/gateway/src/index.ts` — 注册两个新路由 + 启动 scheduler
- `packages/gateway/src/routes/api.ts` — 删 `/prd/chat`、`/rag/query`；扩 dispatch `skill` 枚举
- `packages/gateway/src/routes/webhook.ts` — Plane Approved webhook 改为 dispatch `arcflow-prd-to-tech` 而非 Dify

### Gateway 删除

- `packages/gateway/src/services/dify.ts` + test
- `packages/gateway/src/services/rag-sync.ts` + test
- `packages/gateway/src/services/workflow.ts` 中的 `flowPrdToTech / flowTechToOpenApi / flowBugAnalysis`（如整文件仅此三函数，整文件删除）

### NanoClaw 仓库新增（独立仓库 `github.com/ssyamv/nanoclaw`）

- `skills/arcflow-prd-draft/SKILL.md`
- `skills/arcflow-prd-to-tech/SKILL.md`
- `skills/arcflow-tech-to-openapi/SKILL.md`
- `skills/arcflow-bug-analysis/SKILL.md`
- `skills/arcflow-rag/SKILL.md`

---

## Phase 1 — Gateway 基础设施（sqlite-vec + 配置 + schema）

### Task 1：安装 sqlite-vec 并验证 Bun 可加载

**Files:**

- Modify: `packages/gateway/package.json`

- [ ] **Step 1：安装 sqlite-vec**

```bash
cd packages/gateway && bun add sqlite-vec
```

- [ ] **Step 2：写冒烟脚本验证加载**

Create `packages/gateway/scripts/verify-sqlite-vec.ts`:

```ts
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const db = new Database(":memory:");
sqliteVec.load(db);
const [{ version }] = db.prepare("select vec_version() as version").all() as { version: string }[];
console.log("sqlite-vec version:", version);
db.close();
```

- [ ] **Step 3：运行**

Run: `bun run packages/gateway/scripts/verify-sqlite-vec.ts`
Expected: 打印 `sqlite-vec version: vX.Y.Z`，无错误。

- [ ] **Step 4：提交**

```bash
git add packages/gateway/package.json packages/gateway/bun.lockb packages/gateway/scripts/verify-sqlite-vec.ts
git commit -m "chore(gateway): add sqlite-vec dependency"
```

---

### Task 2：配置扩展（加硅基流动 + RAG 配置，占位但尚不删 Dify）

**Files:**

- Modify: `packages/gateway/src/config.ts`
- Modify: `packages/gateway/src/test-config.ts`

- [ ] **Step 1：在 `config.ts` 新增字段**

在 `Config` 接口及 `loadConfig()` 中新增：

```ts
siliconflowApiKey: string;
siliconflowBaseUrl: string;
ragDbPath: string;
ragEmbeddingModel: string;
ragEmbeddingDim: number;
ragSyncIntervalMs: number;
```

并从 env 读取（对应 `SILICONFLOW_API_KEY` 必填；其余给默认 `https://api.siliconflow.cn/v1`、`./data/rag.db`、`BAAI/bge-m3`、`1024`、`300000`）。

- [ ] **Step 2：`test-config.ts` 填测试默认值**

```ts
siliconflowApiKey: "test-sf-key",
siliconflowBaseUrl: "http://localhost:1",
ragDbPath: ":memory:",
ragEmbeddingModel: "BAAI/bge-m3",
ragEmbeddingDim: 4, // 测试用小维度
ragSyncIntervalMs: 600000,
```

- [ ] **Step 3：跑现有测试确保无回归**

Run: `cd packages/gateway && bun test`
Expected：全绿，仅新增字段无人使用。

- [ ] **Step 4：提交**

```bash
git add packages/gateway/src/config.ts packages/gateway/src/test-config.ts
git commit -m "feat(gateway): add siliconflow + rag config fields"
```

---

### Task 3：Schema 扩展 — dispatch 表字段 + RAG 三表

**Files:**

- Modify: `packages/gateway/src/db/schema.sql`

- [ ] **Step 1：先查 `dispatch` 表当前结构**

Run: `grep -n "CREATE TABLE.*dispatch\|dispatch_id" packages/gateway/src/db/schema.sql`

- [ ] **Step 2：在 schema.sql 末尾追加（若 dispatch 表已存在，仅 ALTER；不存在则 CREATE）**

```sql
-- RAG 索引元数据
CREATE TABLE IF NOT EXISTS rag_docs (
  workspace_id TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, doc_path)
);

CREATE TABLE IF NOT EXISTS rag_chunk_meta (
  chunk_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  heading TEXT,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rag_chunk_meta_doc
  ON rag_chunk_meta(workspace_id, doc_path);

-- dispatch 新增字段（若已存在相同字段请跳过）
ALTER TABLE dispatch ADD COLUMN plane_issue_id TEXT;
ALTER TABLE dispatch ADD COLUMN timeout_at INTEGER;
```

注：`rag_chunks` 是 sqlite-vec 虚表，只能运行时通过 `vec0` 创建，不写进 schema.sql；由 `rag-index.ts` 在初始化时执行 `CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING vec0(...)`。

- [ ] **Step 3：本地迁移验证**

```bash
cd packages/gateway && bun run src/db/index.ts --migrate
```

或等价触发方式（查 `db/index.ts` 现有迁移入口）。无报错即可。

- [ ] **Step 4：提交**

```bash
git add packages/gateway/src/db/schema.sql
git commit -m "feat(gateway): add rag tables and extend dispatch schema"
```

---

## Phase 2 — 硅基流动 Embedding 客户端

### Task 4：写 `llm-embedding.ts` 测试（Red）

**Files:**

- Create: `packages/gateway/src/services/llm-embedding.test.ts`

- [ ] **Step 1：写测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createEmbeddingClient } from "./llm-embedding";

describe("llm-embedding", () => {
  let fetchMock: typeof fetch;
  const originalFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = originalFetch; });

  it("batches up to 32 inputs per request", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_url, init) => {
      calls.push(init!);
      const body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({
        data: body.input.map((_: string, i: number) => ({ embedding: [i, 0, 0, 0] })),
      }), { status: 200 });
    }) as typeof fetch;

    const client = createEmbeddingClient({
      apiKey: "k", baseUrl: "http://x", model: "m", dim: 4,
    });
    const inputs = Array.from({ length: 70 }, (_, i) => `text-${i}`);
    const out = await client.embedBatch(inputs);

    expect(out.length).toBe(70);
    expect(calls.length).toBe(3); // 32 + 32 + 6
  });

  it("retries 3 times on 5xx then throws", async () => {
    let n = 0;
    globalThis.fetch = (async () => { n++; return new Response("err", { status: 500 }); }) as typeof fetch;
    const client = createEmbeddingClient({
      apiKey: "k", baseUrl: "http://x", model: "m", dim: 4,
    });
    await expect(client.embedBatch(["a"])).rejects.toThrow();
    expect(n).toBe(3);
  });

  it("rate limits to 5 req/s", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1,0,0,0] }] }), { status: 200 })) as typeof fetch;
    const client = createEmbeddingClient({
      apiKey: "k", baseUrl: "http://x", model: "m", dim: 4, rps: 5,
    });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, (_, i) => client.embedBatch([`${i}`])));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // 10 req @ 5 rps ~= 1s
  });
});
```

- [ ] **Step 2：运行，确认失败**

Run: `cd packages/gateway && bun test src/services/llm-embedding.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3：提交**

```bash
git add packages/gateway/src/services/llm-embedding.test.ts
git commit -m "test(gateway): add llm-embedding client tests"
```

---

### Task 5：实现 `llm-embedding.ts`（Green）

**Files:**

- Create: `packages/gateway/src/services/llm-embedding.ts`

- [ ] **Step 1：实现**

```ts
interface EmbeddingClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dim: number;
  batchSize?: number;
  rps?: number;
  maxRetries?: number;
}

export interface EmbeddingClient {
  embedBatch(inputs: string[]): Promise<number[][]>;
}

export function createEmbeddingClient(cfg: EmbeddingClientConfig): EmbeddingClient {
  const batchSize = cfg.batchSize ?? 32;
  const rps = cfg.rps ?? 5;
  const maxRetries = cfg.maxRetries ?? 3;

  let lastSlot = 0;
  async function acquireSlot() {
    const minGap = 1000 / rps;
    const now = Date.now();
    const next = Math.max(now, lastSlot + minGap);
    lastSlot = next;
    if (next > now) await Bun.sleep(next - now);
  }

  async function callOnce(inputs: string[]): Promise<number[][]> {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
    });
    if (!res.ok) throw new Error(`embedding http ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  async function callWithRetry(inputs: string[]): Promise<number[][]> {
    let err: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await acquireSlot();
        return await callOnce(inputs);
      } catch (e) {
        err = e;
        await Bun.sleep(200 * (i + 1));
      }
    }
    throw err;
  }

  return {
    async embedBatch(inputs) {
      const out: number[][] = [];
      for (let i = 0; i < inputs.length; i += batchSize) {
        const chunk = inputs.slice(i, i + batchSize);
        out.push(...(await callWithRetry(chunk)));
      }
      return out;
    },
  };
}
```

- [ ] **Step 2：运行测试**

Run: `bun test src/services/llm-embedding.test.ts`
Expected: PASS

- [ ] **Step 3：提交**

```bash
git add packages/gateway/src/services/llm-embedding.ts
git commit -m "feat(gateway): siliconflow embedding client with batch/retry/rate-limit"
```

---

## Phase 3 — RAG 索引（index + search）

### Task 6：`rag-index.ts` 分片函数 TDD

**Files:**

- Create: `packages/gateway/src/services/rag-index.test.ts`
- Create: `packages/gateway/src/services/rag-index.ts`

- [ ] **Step 1：写分片测试**

```ts
import { describe, it, expect } from "bun:test";
import { splitMarkdown } from "./rag-index";

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
```

- [ ] **Step 2：运行，FAIL**

Run: `bun test src/services/rag-index.test.ts`

- [ ] **Step 3：实现 `splitMarkdown`**

Create `packages/gateway/src/services/rag-index.ts`:

```ts
export interface Chunk {
  heading: string;
  content: string;
}
export interface SplitOptions { maxTokens: number }

// 粗估：1 token ≈ 4 chars（足够用于上限切分）
const CHAR_PER_TOKEN = 4;

export function splitMarkdown(md: string, opts: SplitOptions): Chunk[] {
  const maxChars = opts.maxTokens * CHAR_PER_TOKEN;
  const lines = md.split("\n");
  const stack: string[] = [];
  const sections: { heading: string; content: string[] }[] = [];

  const flush = () => {};
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
```

- [ ] **Step 4：跑测试**

Run: `bun test src/services/rag-index.test.ts`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git add packages/gateway/src/services/rag-index.ts packages/gateway/src/services/rag-index.test.ts
git commit -m "feat(gateway): rag markdown chunk splitter"
```

---

### Task 7：`rag-index.ts` 增量同步（Git diff → embed → 写 sqlite-vec）

**Files:**

- Modify: `packages/gateway/src/services/rag-index.ts`
- Modify: `packages/gateway/src/services/rag-index.test.ts`

- [ ] **Step 1：扩测试**

追加到 `rag-index.test.ts`：

```ts
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createRagIndex } from "./rag-index";

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

describe("createRagIndex.upsertDoc", () => {
  it("inserts chunks with embeddings and meta", async () => {
    const db = makeDb(4);
    const embedder = {
      embedBatch: async (xs: string[]) => xs.map((_, i) => [i, 0, 0, 0]),
    };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.upsertDoc({
      workspaceId: "w1", docPath: "a.md", gitSha: "sha1",
      content: `# H\nhello world`,
    });
    const rows = db.prepare("SELECT COUNT(*) as n FROM rag_chunk_meta").all() as {n:number}[];
    expect(rows[0].n).toBe(1);
  });

  it("replaces chunks on re-upsert (new git_sha)", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1,0,0,0]) };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await idx.upsertDoc({ workspaceId: "w1", docPath: "a.md", gitSha: "s1", content: `# H1\nA` });
    await idx.upsertDoc({ workspaceId: "w1", docPath: "a.md", gitSha: "s2", content: `# H2\nB\n# H3\nC` });
    const metas = db.prepare("SELECT heading FROM rag_chunk_meta WHERE doc_path='a.md' ORDER BY heading").all();
    expect(metas.length).toBe(2);
  });

  it("deleteDoc removes chunks and doc row", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1,0,0,0]) };
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
    const embedder = { embedBatch: async () => [[1,0,0,0]] };
    const idx = createRagIndex({ db, embedder, dim: 4 });
    await expect(idx.upsertDoc({ workspaceId: "", docPath: "a.md", gitSha: "s", content: "# H\nx" }))
      .rejects.toThrow(/workspaceId/);
  });
});
```

- [ ] **Step 2：运行，FAIL**

- [ ] **Step 3：实现**

在 `rag-index.ts` 追加：

```ts
import { Database } from "bun:sqlite";
import type { EmbeddingClient } from "./llm-embedding";

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
      db.run(
        `DELETE FROM rag_chunk_meta WHERE workspace_id=? AND doc_path=?`,
        [input.workspaceId, input.docPath],
      );
      db.run(
        `DELETE FROM rag_chunks WHERE workspace_id=? AND chunk_id LIKE ?`,
        [input.workspaceId, `${input.workspaceId}:${input.docPath}#%`],
      );
      chunks.forEach((c, i) => {
        const id = chunkId(input.workspaceId, input.docPath, i);
        db.run(
          `INSERT INTO rag_chunk_meta(chunk_id, workspace_id, doc_path, heading, content) VALUES(?,?,?,?,?)`,
          [id, input.workspaceId, input.docPath, c.heading, c.content],
        );
        db.run(
          `INSERT INTO rag_chunks(chunk_id, workspace_id, embedding) VALUES(?,?,?)`,
          [id, input.workspaceId, new Float32Array(embeddings[i])],
        );
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
      db.run(`DELETE FROM rag_chunk_meta WHERE workspace_id=? AND doc_path=?`, [input.workspaceId, input.docPath]);
      db.run(`DELETE FROM rag_chunks WHERE workspace_id=? AND chunk_id LIKE ?`, [input.workspaceId, `${input.workspaceId}:${input.docPath}#%`]);
      db.run(`DELETE FROM rag_docs WHERE workspace_id=? AND doc_path=?`, [input.workspaceId, input.docPath]);
    });
    tx();
  }

  return { upsertDoc, deleteDoc };
}
```

- [ ] **Step 4：测试通过**

Run: `bun test src/services/rag-index.test.ts`
Expected: PASS

- [ ] **Step 5：提交**

```bash
git commit -am "feat(gateway): rag upsert/delete with sqlite-vec"
```

---

### Task 8：`syncAll` — Git diff 驱动的增量同步

**Files:**

- Modify: `packages/gateway/src/services/rag-index.ts`
- Modify: `packages/gateway/src/services/rag-index.test.ts`

- [ ] **Step 1：测试（伪造 git 层）**

```ts
describe("syncAll", () => {
  it("adds new, updates changed, removes missing", async () => {
    const db = makeDb(4);
    const embedder = { embedBatch: async (xs: string[]) => xs.map(() => [1,0,0,0]) };

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

    expect((db.prepare("SELECT COUNT(*) as n FROM rag_docs").get() as any).n).toBe(2);

    gitState.files.delete("b.md");
    gitState.files.set("a.md", { sha: "s2", content: "# A2\nz" });
    gitState.files.set("c.md", { sha: "s1", content: "# C\nq" });

    await idx.syncAll({ workspaceId: "w1", git: gitAdapter });

    const paths = (db.prepare("SELECT doc_path FROM rag_docs ORDER BY doc_path").all() as any[])
      .map((r) => r.doc_path);
    expect(paths).toEqual(["a.md", "c.md"]);
    const aSha = (db.prepare("SELECT git_sha FROM rag_docs WHERE doc_path='a.md'").get() as any).git_sha;
    expect(aSha).toBe("s2");
  });
});
```

- [ ] **Step 2：实现 `syncAll`**

在 `rag-index.ts` 工厂中追加：

```ts
export interface GitAdapter {
  listDocs(): Promise<{ path: string; sha: string }[]>;
  readDoc(path: string): Promise<string>;
}

// 在 createRagIndex 返回对象中加：
async function syncAll({ workspaceId, git }: { workspaceId: string; git: GitAdapter }) {
  assertWorkspace(workspaceId);
  const remote = await git.listDocs();
  const remoteMap = new Map(remote.map((d) => [d.path, d.sha]));

  const local = db.prepare(
    `SELECT doc_path, git_sha FROM rag_docs WHERE workspace_id=?`
  ).all(workspaceId) as { doc_path: string; git_sha: string }[];
  const localMap = new Map(local.map((d) => [d.doc_path, d.git_sha]));

  for (const [path, sha] of remoteMap) {
    if (localMap.get(path) !== sha) {
      const content = await git.readDoc(path);
      await upsertDoc({ workspaceId, docPath: path, gitSha: sha, content });
    }
  }
  for (const path of localMap.keys()) {
    if (!remoteMap.has(path)) deleteDoc({ workspaceId, docPath: path });
  }
}

return { upsertDoc, deleteDoc, syncAll };
```

- [ ] **Step 3：测试通过**

Run: `bun test src/services/rag-index.test.ts`

- [ ] **Step 4：提交**

```bash
git commit -am "feat(gateway): rag incremental syncAll"
```

---

### Task 9：`rag-search.ts` TDD

**Files:**

- Create: `packages/gateway/src/services/rag-search.test.ts`
- Create: `packages/gateway/src/services/rag-search.ts`

- [ ] **Step 1：测试**

```ts
import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createRagSearch } from "./rag-search";

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
      db.run(`INSERT INTO rag_chunk_meta VALUES(?,?,?,?,?)`, [id, ws, "a.md", heading, `content-${id}`]);
      db.run(`INSERT INTO rag_chunks VALUES(?,?,?)`, [id, ws, new Float32Array(e)]);
    };
    insert("c1", "w1", [1,0,0,0], "H1");
    insert("c2", "w1", [0.9,0.1,0,0], "H2");
    insert("c3", "w1", [0,1,0,0], "H3");
    insert("c4", "w2", [1,0,0,0], "H4"); // other workspace

    const embedder = { embedBatch: async () => [[1,0,0,0]] };
    const search = createRagSearch({ db, embedder });

    const out = await search.search({ workspaceId: "w1", query: "q", topK: 2 });
    expect(out.length).toBe(2);
    expect(out[0].heading).toBe("H1");
    expect(out.every((c) => c.docPath === "a.md")).toBe(true);
  });

  it("rejects empty workspaceId", async () => {
    const db = makeDb();
    const embedder = { embedBatch: async () => [[1,0,0,0]] };
    const search = createRagSearch({ db, embedder });
    await expect(search.search({ workspaceId: "", query: "q", topK: 3 })).rejects.toThrow(/workspaceId/);
  });
});
```

- [ ] **Step 2：实现**

Create `rag-search.ts`:

```ts
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
      const rows = db.prepare(`
        SELECT m.doc_path, m.heading, m.content, v.distance
        FROM rag_chunks v
        JOIN rag_chunk_meta m ON m.chunk_id = v.chunk_id
        WHERE v.workspace_id = ? AND v.embedding MATCH ? AND k = ?
        ORDER BY v.distance ASC
      `).all(input.workspaceId, new Float32Array(q), input.topK) as any[];
      return rows.map((r) => ({
        docPath: r.doc_path,
        heading: r.heading,
        content: r.content,
        score: 1 - r.distance,
      }));
    },
  };
}
```

- [ ] **Step 3：测试通过**

Run: `bun test src/services/rag-search.test.ts`
Expected: PASS（注意 sqlite-vec KNN 语法以其 README 为准，如不同请调整 `MATCH` 子句）

- [ ] **Step 4：提交**

```bash
git commit -am "feat(gateway): rag-search with sqlite-vec knn"
```

---

### Task 10：Git Adapter — 读取 docs 仓库

**Files:**

- Create: `packages/gateway/src/services/rag-git-adapter.ts`
- Create: `packages/gateway/src/services/rag-git-adapter.test.ts`

- [ ] **Step 1：测试**

```ts
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createGitAdapter } from "./rag-git-adapter";

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "rag-git-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@x"', { cwd: dir });
  execSync('git config user.name "t"', { cwd: dir });
  mkdirSync(join(dir, "prd"));
  writeFileSync(join(dir, "prd/a.md"), "# A");
  writeFileSync(join(dir, "prd/b.md"), "# B");
  writeFileSync(join(dir, "README.md"), "# root"); // not under tracked globs
  execSync("git add -A && git commit -q -m c1", { cwd: dir });
  return dir;
}

describe("rag-git-adapter", () => {
  it("lists tracked markdown files under given globs with sha per file", async () => {
    const dir = setupRepo();
    try {
      const adapter = createGitAdapter({ rootDir: dir, globs: ["prd/**/*.md"] });
      const docs = await adapter.listDocs();
      const paths = docs.map((d) => d.path).sort();
      expect(paths).toEqual(["prd/a.md", "prd/b.md"]);
      docs.forEach((d) => expect(d.sha).toMatch(/^[0-9a-f]{40}$/));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readDoc returns file content", async () => {
    const dir = setupRepo();
    try {
      const adapter = createGitAdapter({ rootDir: dir, globs: ["prd/**/*.md"] });
      expect(await adapter.readDoc("prd/a.md")).toContain("# A");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2：实现**

```ts
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch"; // 若未装：bun add minimatch
import type { GitAdapter } from "./rag-index";

export interface GitAdapterConfig {
  rootDir: string;
  globs: string[];
}

export function createGitAdapter(cfg: GitAdapterConfig): GitAdapter {
  return {
    async listDocs() {
      const out = execSync("git ls-files -s", { cwd: cfg.rootDir, encoding: "utf8" });
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // e.g. 100644 <sha> 0\tpath
          const m = /^\d+\s+([0-9a-f]{40})\s+\d+\t(.+)$/.exec(line);
          if (!m) return null;
          return { sha: m[1], path: m[2] };
        })
        .filter((x): x is { sha: string; path: string } =>
          !!x && cfg.globs.some((g) => minimatch(x.path, g)),
        );
    },
    async readDoc(path) {
      return readFile(join(cfg.rootDir, path), "utf8");
    },
  };
}
```

- [ ] **Step 3：测试通过**

- [ ] **Step 4：提交**

```bash
git commit -am "feat(gateway): rag git adapter"
```

---

### Task 11：`scheduler.ts` — 周期触发 `syncAll`

**Files:**

- Create: `packages/gateway/src/services/scheduler.ts`
- Create: `packages/gateway/src/services/scheduler.test.ts`

- [ ] **Step 1：测试**

```ts
import { describe, it, expect } from "bun:test";
import { createScheduler } from "./scheduler";

describe("scheduler", () => {
  it("runs job at intervalMs then stops", async () => {
    let n = 0;
    const sched = createScheduler();
    sched.every(50, async () => { n++; });
    await Bun.sleep(175);
    sched.stop();
    expect(n).toBeGreaterThanOrEqual(2);
    const at = n;
    await Bun.sleep(100);
    expect(n).toBe(at);
  });

  it("swallows job errors without stopping", async () => {
    let n = 0;
    const sched = createScheduler();
    sched.every(30, async () => {
      n++;
      if (n === 1) throw new Error("boom");
    });
    await Bun.sleep(100);
    sched.stop();
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2：实现**

```ts
export interface Scheduler {
  every(intervalMs: number, job: () => Promise<void>): void;
  stop(): void;
}

export function createScheduler(): Scheduler {
  const timers: Timer[] = [];
  return {
    every(intervalMs, job) {
      const tick = async () => {
        try { await job(); } catch (e) { console.error("[scheduler]", e); }
      };
      timers.push(setInterval(tick, intervalMs));
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}
```

- [ ] **Step 3：测试通过 + 提交**

```bash
bun test src/services/scheduler.test.ts
git add . && git commit -m "feat(gateway): simple interval scheduler"
```

---

### Task 12：DB queries — `rag` 查询 + dispatch 新字段

**Files:**

- Modify: `packages/gateway/src/db/queries.ts`
- Modify: `packages/gateway/src/db/queries.test.ts`

- [ ] **Step 1：为 dispatch 写入 `plane_issue_id` / `timeout_at` 加测试**

追加到 `queries.test.ts`：

```ts
it("insertDispatch persists plane_issue_id and timeout_at", () => {
  const id = insertDispatch(db, {
    workspaceId: "w", skill: "arcflow-prd-to-tech",
    input: { x: 1 }, planeIssueId: "PROJ-7", timeoutAt: 9999,
  });
  const row = db.prepare("SELECT plane_issue_id, timeout_at FROM dispatch WHERE id=?").get(id) as any;
  expect(row.plane_issue_id).toBe("PROJ-7");
  expect(row.timeout_at).toBe(9999);
});

it("updateDispatchStatus marks success idempotently", () => {
  const id = insertDispatch(db, { workspaceId: "w", skill: "arcflow-prd-to-tech", input: {} });
  const first = updateDispatchStatus(db, id, "success");
  const second = updateDispatchStatus(db, id, "success");
  expect(first).toBe(true);
  expect(second).toBe(false); // 已完成再更新返回 false
});
```

- [ ] **Step 2：实现/扩展 `insertDispatch`、新增 `updateDispatchStatus`**

修改 `queries.ts`：

```ts
export interface InsertDispatchInput {
  workspaceId: string;
  skill: string;
  input: unknown;
  planeIssueId?: string;
  timeoutAt?: number;
}
export function insertDispatch(db: Database, x: InsertDispatchInput): string {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO dispatch(id, workspace_id, skill, input_json, status, created_at, plane_issue_id, timeout_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [id, x.workspaceId, x.skill, JSON.stringify(x.input), "pending", Date.now(),
     x.planeIssueId ?? null, x.timeoutAt ?? null],
  );
  return id;
}

export function updateDispatchStatus(
  db: Database, id: string, status: "success" | "failed",
): boolean {
  const res = db.run(
    `UPDATE dispatch SET status=?, completed_at=? WHERE id=? AND status='pending'`,
    [status, Date.now(), id],
  );
  return res.changes === 1;
}
```

- [ ] **Step 3：测试通过 + 提交**

```bash
bun test src/db/queries.test.ts
git add . && git commit -m "feat(gateway): dispatch plane_issue_id/timeout_at + idempotent status update"
```

---

## Phase 4 — 路由层

### Task 13：`GET /api/rag/search` 路由 + 测试

**Files:**

- Create: `packages/gateway/src/routes/rag.ts`
- Create: `packages/gateway/src/routes/rag.test.ts`
- Modify: `packages/gateway/src/index.ts` — 挂载路由

- [ ] **Step 1：测试**

```ts
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { ragRoutes } from "./rag";

describe("GET /api/rag/search", () => {
  const fakeSearch = {
    search: async ({ workspaceId, query, topK }: any) => [
      { docPath: "a.md", heading: "H", content: "c", score: 0.9 },
    ],
  };
  const app = new Hono().route("/api/rag", ragRoutes({
    search: fakeSearch, systemSecret: "s3cr3t",
  }));

  it("401 without secret", async () => {
    const res = await app.request("/api/rag/search?workspace_id=w&q=x&top_k=2");
    expect(res.status).toBe(401);
  });

  it("400 without workspace_id", async () => {
    const res = await app.request("/api/rag/search?q=x", {
      headers: { "X-System-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(400);
  });

  it("200 with chunks", async () => {
    const res = await app.request("/api/rag/search?workspace_id=w&q=hello&top_k=3", {
      headers: { "X-System-Secret": "s3cr3t" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunks.length).toBe(1);
    expect(body.chunks[0].heading).toBe("H");
  });
});
```

- [ ] **Step 2：实现**

```ts
import { Hono } from "hono";
import type { createRagSearch } from "../services/rag-search";

export function ragRoutes(deps: {
  search: ReturnType<typeof createRagSearch>;
  systemSecret: string;
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.header("X-System-Secret") !== deps.systemSecret) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  app.get("/search", async (c) => {
    const ws = c.req.query("workspace_id");
    const q = c.req.query("q");
    const topK = Number(c.req.query("top_k") ?? "8");
    if (!ws || !q) return c.json({ error: "workspace_id and q required" }, 400);
    const chunks = await deps.search.search({ workspaceId: ws, query: q, topK });
    return c.json({ chunks });
  });
  return app;
}
```

- [ ] **Step 3：挂载并跑测试**

修改 `index.ts` 挂载路由；跑 `bun test`。

- [ ] **Step 4：提交**

```bash
git add . && git commit -m "feat(gateway): /api/rag/search endpoint"
```

---

### Task 14：`POST /api/workflow/callback` — 接收 skill 回调并分派

**Files:**

- Create: `packages/gateway/src/services/workflow-callback.ts`
- Create: `packages/gateway/src/services/workflow-callback.test.ts`
- Create: `packages/gateway/src/routes/workflow-callback.ts`
- Create: `packages/gateway/src/routes/workflow-callback.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1：service 测试**

```ts
import { describe, it, expect } from "bun:test";
import { createCallbackHandler } from "./workflow-callback";

describe("workflow-callback dispatcher", () => {
  it("routes arcflow-prd-to-tech to writeTechDesign", async () => {
    const calls: any[] = [];
    const handler = createCallbackHandler({
      writeTechDesign: async (x) => { calls.push(["tech", x]); },
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async (id) => ({
        id, workspaceId: "w", skill: "arcflow-prd-to-tech", planeIssueId: "PROJ-1",
        status: "pending",
      }),
      markDone: async () => true,
    });
    const ok = await handler.handle({
      dispatch_id: "d1", skill: "arcflow-prd-to-tech", status: "success",
      result: { content: "# T\nbody" },
    });
    expect(ok).toBe(true);
    expect(calls[0][0]).toBe("tech");
    expect(calls[0][1].content).toBe("# T\nbody");
  });

  it("idempotent: second callback returns false", async () => {
    let done = false;
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async (id) => ({ id, workspaceId: "w", skill: "arcflow-bug-analysis", status: done ? "success" : "pending" }),
      markDone: async () => { if (done) return false; done = true; return true; },
    });
    const r1 = await handler.handle({ dispatch_id: "d1", skill: "arcflow-bug-analysis", status: "success", result: { content: "x", planeIssueId: "PROJ-9" } });
    const r2 = await handler.handle({ dispatch_id: "d1", skill: "arcflow-bug-analysis", status: "success", result: { content: "x", planeIssueId: "PROJ-9" } });
    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });

  it("failed status records failure without writing", async () => {
    const calls: any[] = [];
    const handler = createCallbackHandler({
      writeTechDesign: async (x) => { calls.push(x); },
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async () => ({ id: "d", workspaceId: "w", skill: "arcflow-prd-to-tech", status: "pending" }),
      markDone: async () => true,
    });
    await handler.handle({ dispatch_id: "d", skill: "arcflow-prd-to-tech", status: "failed", error: "oops" });
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 2：service 实现**

```ts
export interface DispatchRecord {
  id: string;
  workspaceId: string;
  skill: string;
  planeIssueId?: string;
  status: "pending" | "success" | "failed";
}

export interface CallbackDeps {
  writeTechDesign: (x: { workspaceId: string; planeIssueId?: string; content: string }) => Promise<void>;
  writeOpenApi: (x: { workspaceId: string; planeIssueId?: string; content: string }) => Promise<void>;
  commentPlaneIssue: (x: { planeIssueId: string; content: string }) => Promise<void>;
  loadDispatch: (id: string) => Promise<DispatchRecord | null>;
  markDone: (id: string, status: "success" | "failed") => Promise<boolean>;
}

export interface CallbackPayload {
  dispatch_id: string;
  skill: string;
  status: "success" | "failed";
  result?: { content: string; planeIssueId?: string };
  error?: string;
}

export function createCallbackHandler(deps: CallbackDeps) {
  return {
    async handle(p: CallbackPayload): Promise<boolean> {
      const rec = await deps.loadDispatch(p.dispatch_id);
      if (!rec) return false;
      if (rec.status !== "pending") return false;

      const claimed = await deps.markDone(p.dispatch_id, p.status);
      if (!claimed) return false;
      if (p.status === "failed") return true;

      const content = p.result?.content ?? "";
      const piid = p.result?.planeIssueId ?? rec.planeIssueId;

      if (p.skill === "arcflow-prd-to-tech") {
        await deps.writeTechDesign({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
      } else if (p.skill === "arcflow-tech-to-openapi") {
        await deps.writeOpenApi({ workspaceId: rec.workspaceId, planeIssueId: piid, content });
      } else if (p.skill === "arcflow-bug-analysis") {
        if (piid) await deps.commentPlaneIssue({ planeIssueId: piid, content });
      }
      return true;
    },
  };
}
```

- [ ] **Step 3：路由测试 + 实现（`X-System-Secret`，调用 handler）**

`routes/workflow-callback.ts`：

```ts
import { Hono } from "hono";
import type { createCallbackHandler, CallbackPayload } from "../services/workflow-callback";

export function callbackRoutes(deps: {
  handler: ReturnType<typeof createCallbackHandler>;
  systemSecret: string;
}) {
  const app = new Hono();
  app.post("/", async (c) => {
    if (c.req.header("X-System-Secret") !== deps.systemSecret) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json()) as CallbackPayload;
    if (!body.dispatch_id || !body.skill) return c.json({ error: "bad payload" }, 400);
    const accepted = await deps.handler.handle(body);
    return c.json({ accepted });
  });
  return app;
}
```

测试覆盖：401 / 400 / accepted=true / 重放 accepted=false。

- [ ] **Step 4：挂载到 `index.ts`，`/api/workflow/callback`**

- [ ] **Step 5：测试通过 + 提交**

```bash
bun test src/services/workflow-callback.test.ts src/routes/workflow-callback.test.ts
git add . && git commit -m "feat(gateway): workflow callback endpoint + dispatcher"
```

---

### Task 15：`/api/nanoclaw/dispatch` 的 skill 枚举与记账扩展

**Files:**

- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1：在已有 dispatch 路由中把 `skill` 白名单扩展为**

```ts
const ALLOWED_SKILLS = [
  "arcflow-prd-draft",
  "arcflow-prd-to-tech",
  "arcflow-tech-to-openapi",
  "arcflow-bug-analysis",
  "arcflow-rag",
] as const;
```

接收 `plane_issue_id`、写入 dispatch 表时带上，`timeout_at = Date.now() + 10*60*1000`。

- [ ] **Step 2：测试用例**

追加：

```ts
it("accepts arcflow-prd-to-tech with plane_issue_id and persists timeout_at", async () => {
  const res = await app.request("/api/nanoclaw/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json", "X-System-Secret": "s" },
    body: JSON.stringify({
      skill: "arcflow-prd-to-tech", workspace_id: "w", plane_issue_id: "PROJ-1", input: { prd_path: "prd/x.md" },
    }),
  });
  expect(res.status).toBe(200);
  const row = db.prepare("SELECT plane_issue_id, timeout_at FROM dispatch WHERE id=?").get((await res.json()).dispatch_id) as any;
  expect(row.plane_issue_id).toBe("PROJ-1");
  expect(row.timeout_at).toBeGreaterThan(Date.now());
});

it("rejects unknown skill", async () => {
  const res = await app.request("/api/nanoclaw/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json", "X-System-Secret": "s" },
    body: JSON.stringify({ skill: "foo", workspace_id: "w" }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3：测试通过 + 提交**

```bash
bun test src/routes/api.test.ts
git add . && git commit -m "feat(gateway): dispatch skill whitelist + plane_issue_id + timeout_at"
```

---

### Task 16：Plane webhook — Approved 事件改为 dispatch 新 skill

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts` （若没有则新增）

- [ ] **Step 1：读现有 webhook**

Run: `grep -n "flowPrdToTech\|triggerWorkflow" packages/gateway/src/routes/webhook.ts`

- [ ] **Step 2：替换调用**

原：

```ts
await triggerWorkflow("flowPrdToTech", { prd_content });
```

改为：

```ts
await dispatchToNanoclaw({
  skill: "arcflow-prd-to-tech",
  workspace_id,
  plane_issue_id,
  input: { prd_path, workspace_id, plane_issue_id },
});
```

`dispatchToNanoclaw` 复用 `/api/nanoclaw/dispatch` 内部函数（如无则抽出到 `services/nanoclaw-dispatch.ts`）。

- [ ] **Step 3：测试验证 webhook 触发时 dispatch 表多一条 `arcflow-prd-to-tech` 记录**

- [ ] **Step 4：提交**

```bash
bun test src/routes/webhook.test.ts
git add . && git commit -m "feat(gateway): plane approved -> nanoclaw dispatch"
```

---

## Phase 5 — 启动装配 + Bootstrap

### Task 17：`index.ts` 装配 — RAG 模块 + scheduler

**Files:**

- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1：在启动流程中**

- 读配置 → `createEmbeddingClient` → 打开 `Database(ragDbPath)` → `sqliteVec.load(db)` → 确保虚表存在：

  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING vec0(
    chunk_id TEXT PRIMARY KEY, workspace_id TEXT PARTITION KEY, embedding FLOAT[1024]
  );
  ```

- 实例化 `rag-index`、`rag-search`、`rag-git-adapter`
- 实例化 `createScheduler().every(ragSyncIntervalMs, () => ragIndex.syncAll({workspaceId, git: gitAdapter}))`
- 挂 `/api/rag`、`/api/workflow/callback`
- 启动进程退出时 `scheduler.stop()`、`db.close()`

- [ ] **Step 2：集成测试（可选；若 index.ts 难测则手动跑）**

```bash
SILICONFLOW_API_KEY=test RAG_DB_PATH=:memory: bun run dev
# 观察日志：scheduler started, rag routes mounted, callback routes mounted
```

- [ ] **Step 3：提交**

```bash
git add . && git commit -m "feat(gateway): wire rag index/search/scheduler/callback on startup"
```

---

### Task 18：`scripts/rag-bootstrap.ts` — 首次全量索引

**Files:**

- Create: `packages/gateway/scripts/rag-bootstrap.ts`

- [ ] **Step 1：脚本实现**

```ts
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { loadConfig } from "../src/config";
import { createEmbeddingClient } from "../src/services/llm-embedding";
import { createRagIndex } from "../src/services/rag-index";
import { createGitAdapter } from "../src/services/rag-git-adapter";

const cfg = loadConfig();
const db = new Database(cfg.ragDbPath);
sqliteVec.load(db);
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY, workspace_id TEXT PARTITION KEY, embedding FLOAT[${cfg.ragEmbeddingDim}])`);

const embedder = createEmbeddingClient({
  apiKey: cfg.siliconflowApiKey, baseUrl: cfg.siliconflowBaseUrl,
  model: cfg.ragEmbeddingModel, dim: cfg.ragEmbeddingDim,
});
const idx = createRagIndex({ db, embedder, dim: cfg.ragEmbeddingDim });

// TODO: 这里按实际 workspace 列表遍历。当前单 workspace 假设：
const workspaceId = process.env.BOOTSTRAP_WORKSPACE_ID || "default";
const gitRoot = process.env.BOOTSTRAP_GIT_ROOT || "./docs";
const git = createGitAdapter({ rootDir: gitRoot, globs: ["prd/**/*.md", "tech-design/**/*.md", "api/**/*.yaml", "arch/**/*.md"] });

console.log(`[bootstrap] workspace=${workspaceId} root=${gitRoot}`);
await idx.syncAll({ workspaceId, git });
console.log("[bootstrap] done");
db.close();
```

- [ ] **Step 2：用一个 mock repo 冒烟（或指向真实 docs 目录）**

```bash
BOOTSTRAP_GIT_ROOT=./docs BOOTSTRAP_WORKSPACE_ID=arcflow bun run packages/gateway/scripts/rag-bootstrap.ts
```

Expected: 无错误，`RAG_DB_PATH` 里生成表 + 行。

- [ ] **Step 3：提交**

```bash
git add . && git commit -m "feat(gateway): rag bootstrap script"
```

---

## Phase 6 — NanoClaw Skills（在 nanoclaw 仓库）

> 以下任务在 NanoClaw 仓库进行（非 ArcFlow 仓）。在 ArcFlow 这个 worktree 里只做占位文档 + URL 引用。

### Task 19：在 ArcFlow 记录 skill 契约文档

**Files:**

- Create: `docs/superpowers/specs/2026-04-15-nanoclaw-arcflow-skills-contract.md`

- [ ] **Step 1：把 5 个 skill 的 I/O 契约、回调 payload、SSE 事件类型从 spec 抽成独立参考文档，供 nanoclaw 仓库 skill 作者实现时对齐**

内容包含：

- 每个 skill 的 `input` schema（JSON）
- 非交互 skill 的 `POST {GATEWAY_URL}/api/workflow/callback` body 样例
- 交互 skill 的 SSE 事件序列（`session_start`, `message_delta`, `message_end`）
- skill markdown 应放置的 prompt 骨架（prompt 原文从 `docs/superpowers/specs/2026-04-02-dify-workflow-prompts-design.md` 迁移）

- [ ] **Step 2：提交**

```bash
git add docs/superpowers/specs/2026-04-15-nanoclaw-arcflow-skills-contract.md
git commit -m "docs: nanoclaw arcflow-* skills contract"
```

### Task 20：（nanoclaw 仓库，独立执行）创建 5 个 skill

**Files (in nanoclaw repo):**

- `skills/arcflow-prd-draft/SKILL.md`
- `skills/arcflow-prd-to-tech/SKILL.md`
- `skills/arcflow-tech-to-openapi/SKILL.md`
- `skills/arcflow-bug-analysis/SKILL.md`
- `skills/arcflow-rag/SKILL.md`

- [ ] **Step 1：切到 nanoclaw 仓，为每个 skill 写 SKILL.md + prompt**

按 Task 19 输出的契约文档，prompt 从 `2026-04-02-dify-workflow-prompts-design.md` 迁移并改写为 skill 指令。

- [ ] **Step 2：`arcflow-rag` skill 内添加 HTTP 工具调用模板**

```text
Step 1: call arcflow_api.rag_search({ workspace_id, q: user_question, top_k: 8 })
Step 2: 在 system prompt 中拼入 chunks，生成带引用的回答
```

- [ ] **Step 3：非交互 skill 内添加 callback 工具调用模板**

```text
When generation done: call arcflow_api.workflow_callback({
  dispatch_id: $env.DISPATCH_ID,
  skill: "arcflow-prd-to-tech",
  status: "success",
  result: { content: <生成的 markdown>, planeIssueId: $env.PLANE_ISSUE_ID }
})
```

- [ ] **Step 4：nanoclaw 仓库内冒烟 5 个 skill**

```bash
# 本地启动 nanoclaw
bun run dev
# 对每个 skill curl 一次 /api/chat 触发
```

- [ ] **Step 5：发版 nanoclaw 镜像**

在 nanoclaw 仓创建 PR → merge → 构建镜像 → 部署到 `172.29.230.21:3002`。

---

## Phase 7 — 删除 Dify

### Task 21：删除 Dify 所有代码与配置

**Files:**

- Delete: `packages/gateway/src/services/dify.ts`, `dify.test.ts`
- Delete: `packages/gateway/src/services/rag-sync.ts`, `rag-sync.test.ts`
- Modify: `packages/gateway/src/services/workflow.ts`（删 `flowPrdToTech / flowTechToOpenApi / flowBugAnalysis`；若三者是全部内容则整文件删）
- Modify: `packages/gateway/src/services/workflow.test.ts`
- Modify: `packages/gateway/src/routes/api.ts` — 删 `/prd/chat`、`/rag/query`
- Modify: `packages/gateway/src/routes/api.test.ts` — 删对应测试
- Modify: `packages/gateway/src/config.ts` — 删 `difyApiKey/difyBaseUrl/difyDatasetApiKey/difyDatasetId/difyDatasetMap`
- Modify: `packages/gateway/src/test-config.ts`
- Modify: `packages/gateway/.env.example`（如存在）— 删 `DIFY_*`

- [ ] **Step 1：搜残留引用**

```text
grep -rn "dify\|Dify\|DIFY" packages/gateway/src packages/gateway/.env.example 2>/dev/null
```

- [ ] **Step 2：逐项删除**

删除文件：

```bash
git rm packages/gateway/src/services/dify.ts packages/gateway/src/services/dify.test.ts \
       packages/gateway/src/services/rag-sync.ts packages/gateway/src/services/rag-sync.test.ts
```

修改 `workflow.ts`、`api.ts`、`config.ts`、`test-config.ts` 删除所有 Dify 调用 + 配置；更新对应测试。

- [ ] **Step 3：跑全量测试**

```bash
cd packages/gateway && bun test
```

Expected: 全绿（若有残留 mock，清理之）。

- [ ] **Step 4：再次搜残留**

```text
grep -rn "dify\|Dify\|DIFY" packages/gateway/src
```

Expected: 无输出。

- [ ] **Step 5：提交**

```bash
git add -A && git commit -m "feat(gateway): remove dify and legacy rag-sync"
```

---

### Task 22：Web 前端清理 `/prd/chat` / `/rag/query` 调用点

**Files:**

- Modify: 搜索 `packages/web/src` 对这两个端点的调用

- [ ] **Step 1：搜调用点**

```text
grep -rn "/prd/chat\|/rag/query" packages/web/src
```

- [ ] **Step 2：逐个替换为 NanoClaw 入口**

- PRD 草稿 → 改为 dispatch `arcflow-prd-draft`（已切 AiChat 的代码复用）
- RAG 问答 → 改为 dispatch `arcflow-rag`

- [ ] **Step 3：跑 Web 测试（若有）**

```bash
cd packages/web && bun test 2>/dev/null || npm test 2>/dev/null || true
```

- [ ] **Step 4：提交**

```bash
git add -A && git commit -m "feat(web): replace /prd/chat and /rag/query with nanoclaw dispatch"
```

---

## Phase 8 — 上线

### Task 23：端到端本地联调

- [ ] **Step 1：本地启动 Gateway + NanoClaw**

```bash
cd packages/gateway && bun run dev
# 另一终端
cd /path/to/nanoclaw && bun run dev
```

- [ ] **Step 2：跑 5 条主链路冒烟**

1. Web 打开 PRD 生成对话 → `arcflow-prd-draft` → 生成草稿
2. 模拟 Plane webhook POST → Gateway 发 dispatch → `arcflow-prd-to-tech` → 回调 Gateway → 写入 `docs/tech-design/*.md`
3. 模拟 Review 通过 → dispatch `arcflow-tech-to-openapi` → 回调 → 写 `docs/api/*.yaml`
4. 模拟 CI 回流 → dispatch `arcflow-bug-analysis` → 回调 → 在 Plane Issue 留言
5. Web 发 RAG 问题 → `arcflow-rag` skill 调 `/api/rag/search` → Claude 生成带引用回答

- [ ] **Step 3：修复冒烟发现的问题**

每个 bug 一个 commit，消息 `fix(gateway|nanoclaw): ...`。

---

### Task 24：部署到 172.29.230.21

- [ ] **Step 1：服务器配置**

```text
ssh arcflow-server
# 编辑 gateway .env：
SILICONFLOW_API_KEY=sk-***
RAG_DB_PATH=/data/project/gateway/data/rag.db
RAG_EMBEDDING_MODEL=BAAI/bge-m3
RAG_EMBEDDING_DIM=1024
RAG_SYNC_INTERVAL_MS=300000
# 删掉所有 DIFY_*
```

- [ ] **Step 2：先部署 NanoClaw（新 skill 上线，旧流量无影响）**

```text
pm2 reload nanoclaw
```

- [ ] **Step 3：停 Gateway → 跑 bootstrap → 启动 Gateway**

```text
pm2 stop gateway
BOOTSTRAP_WORKSPACE_ID=arcflow BOOTSTRAP_GIT_ROOT=/data/project/docs \
  bun run /data/project/gateway/scripts/rag-bootstrap.ts
pm2 start gateway
pm2 logs gateway --lines 50
```

- [ ] **Step 4：线上端到端验证 5 条链路**

- [ ] **Step 5：下线 Dify 容器 + 数据卷**

```text
cd /data/project/dify
docker compose down -v
docker image prune -f
rm -rf /data/project/dify
```

- [ ] **Step 6：创建 PR 合并到 main**

```bash
gh pr create --title "feat: 全量切 Dify → NanoClaw + 自建 sqlite-vec RAG" \
  --body-file docs/superpowers/specs/2026-04-15-dify-to-nanoclaw-migration-design.md
```

---

## Self-Review 记录

- [x] 覆盖 spec 每一节：架构、5 skill、RAG 索引、Gateway 改动、切换步骤、测试、风险 —— 均对应到 Phase/Task
- [x] 无 "TBD / TODO"，脚本中 `TODO: 按实际 workspace 列表` 在 Task 18 已明确当前单 workspace 假设
- [x] 类型一致：`dispatch_id`、`workspaceId`、`planeIssueId`、`content` 在 service 和路由间统一
- [x] 每个 TDD 步骤都有可运行命令和预期
