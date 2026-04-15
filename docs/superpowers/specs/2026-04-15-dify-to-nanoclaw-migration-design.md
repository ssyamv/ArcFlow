# Dify → NanoClaw 全量迁移设计

- 日期：2026-04-15
- 状态：已定稿，待实施
- 范围：Gateway + NanoClaw（arcflow-* skills），一次性切换

## 背景

当前 Dify 承担四条工作流（PRD→技术设计、技术设计→OpenAPI、CI 日志→Bug 报告、RAG 问答）+ 向量库。NanoClaw dispatch 通道已打通（Web 聊天已切 NanoClaw，#108/#112 完成鉴权透传）。`services/dify.ts` 已标记 `@deprecated`，本设计完成 Dify 全量下线。

## 设计决策摘要

| 决策项 | 选择 | 理由 |
|---|---|---|
| RAG 切换范围 | 全切至 NanoClaw，自建向量库 | 彻底摆脱 Dify 依赖 |
| 向量库 | sqlite-vec | 零新增服务，与 Gateway SQLite 共存 |
| Embedding | 硅基流动 BAAI/bge-m3 (1024 维) | 国内低延迟，OpenAI 兼容接口 |
| Prompt/编排 | 全部 NanoClaw skill 化 | 单一执行引擎，避免 Gateway 承担 LLM 调度 |
| 同步/异步 | Gateway dispatch → NanoClaw callback Gateway | 写 Git/飞书/Plane 集中在 Gateway |
| PRD 多轮对话 | `arcflow-prd-draft` skill 承接，`/prd/chat` 下线 | Web 已切 NanoClaw，去除冗余代理 |
| RAG 索引归属 | Gateway 维护（sqlite-vec 文件在 Gateway） | Gateway 是唯一数据层出口 |
| 切换节奏 | 一次性切换，单 PR，直接删 Dify 容器 | 无线上用户，无需兜底 |

## 架构总览

```text
ArcFlow Web ──┐
              ├─→ NanoClaw (Agent SDK + 5 个 arcflow-* skill)
飞书/Plane ──→ Gateway ──┤         │
                         │         ├─→ Claude API (走 SG 代理)
                         │         ├─→ Gateway /api/rag/search  (检索)
                         │         └─→ Gateway /api/workflow/callback (落盘+通知)
                         └─→ sqlite-vec 索引 + 硅基流动 embedding
```

## NanoClaw Skills（5 个）

所有 skill 位于 nanoclaw 仓库 `skills/arcflow-*/SKILL.md`，prompt 改动 = skill 发版 = NanoClaw 部署。

| Skill | 触发方 | 输入 | 输出 | 模型 | 模式 |
|---|---|---|---|---|---|
| `arcflow-prd-draft` | Web AiChat | 用户多轮消息 + `workspace_id` | SSE 流式 markdown，最终 PRD 草稿 | sonnet-4-6 | 交互式多轮 |
| `arcflow-prd-to-tech` | Gateway dispatch（Plane Approved webhook） | `{prd_path, workspace_id, plane_issue_id}` | callback 带技术设计 md | opus-4-6 | 单次 |
| `arcflow-tech-to-openapi` | Gateway dispatch（Review 通过） | `{tech_path, workspace_id}` | callback 带 OpenAPI yaml | sonnet-4-6 | 单次 |
| `arcflow-bug-analysis` | Gateway dispatch（CI 回流） | `{ci_log, context, workspace_id}` | callback 带 Bug 报告 md | sonnet-4-6 | 单次 |
| `arcflow-rag` | Web / 飞书 | `{question, workspace_id, conversation_id?}` | SSE 流式回答 + 引用 | sonnet-4-6 | 交互式（内部调 Gateway 检索） |

**回调约定**：非交互 skill 完成后 `POST {GATEWAY_URL}/api/workflow/callback`（`X-System-Secret` 鉴权），body：

```json
{
  "dispatch_id": "...",
  "skill": "arcflow-prd-to-tech",
  "status": "success",
  "result": { "content": "...", "meta": {} },
  "error": null
}
```

交互式 skill 走前端已有 SSE 链路，不回调 Gateway。

## RAG 流水线

### 索引链路（Gateway 内，5 min cron）

```text
docs Git ─→ git pull ─→ diff (按 git sha 比对 rag_docs 表)
          ─→ 分片（按 markdown heading + 800 token 上限）
          ─→ 硅基流动 /v1/embeddings (BAAI/bge-m3, 1024 维, 批量 32, 5 req/s 限流)
          ─→ sqlite-vec 写入 / 删除 / 更新
```

### 检索链路

```text
NanoClaw arcflow-rag skill
  → GET /api/rag/search?workspace_id=&q=&top_k=8
  → Gateway: 对 q embedding → sqlite-vec KNN
  → 返回 [{doc_path, heading, content, score}]
  → skill 把片段 + 引用塞 system prompt
  → Claude sonnet-4-6 生成带 [1][2] 引用的回答
  → SSE 末尾附 sources 列表
```

### 数据模型

```sql
CREATE TABLE rag_docs (
  workspace_id TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, doc_path)
);

CREATE VIRTUAL TABLE rag_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  workspace_id TEXT PARTITION KEY,
  embedding FLOAT[1024]
);

CREATE TABLE rag_chunk_meta (
  chunk_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  heading TEXT,
  content TEXT NOT NULL
);
```

### 隔离与一致性

- 所有 index / search 路径强制断言 `workspace_id` 非空
- 每个 workspace 独立 `git_root` 配置
- 启动时若 `rag_docs` 为空触发全量索引（`bun run rag:bootstrap`）

## Gateway 改动

### 新增端点

| 端点 | 说明 |
|---|---|
| `GET /api/rag/search` | `X-System-Secret`；`workspace_id, q, top_k=8`；返回 `{chunks:[{doc_path,heading,content,score}]}` |
| `POST /api/workflow/callback` | `X-System-Secret`；接收 skill 完成回调，按 `skill` 分派到落盘+通知 |

### 新增服务模块

- `services/llm-embedding.ts` — 硅基流动客户端（批量、重试、限流）
- `services/rag-index.ts` — Git diff → 分片 → embedding → 写 sqlite-vec
- `services/rag-search.ts` — query embedding → KNN → 返回 chunks
- `services/workflow-callback.ts` — 按 skill 分派：
  - `arcflow-prd-to-tech` → 写 `docs/tech-design/*.md` + 发飞书 Review 卡片
  - `arcflow-tech-to-openapi` → 写 `docs/api/*.yaml` + 通知
  - `arcflow-bug-analysis` → 写 Plane Issue comment

### dispatch 记账

`dispatch` 表扩 `skill, plane_issue_id, workspace_id, status, timeout_at`，callback 依据 `dispatch_id` 匹配。幂等：同 `dispatch_id` 重复 callback 只写一次。

### 调度器

`services/scheduler.ts` 新增 `rag-sync` cron（5 min），调用 `rag-index.syncAll()`。

### 删除清单

- `services/dify.ts`、`services/rag-sync.ts`
- `services/workflow.ts` 中 `flowPrdToTech / flowTechToOpenApi / flowBugAnalysis`（整文件可能删）
- 路由 `/prd/chat`、`/rag/query`
- `config.ts` 中所有 `difyApiKey / difyBaseUrl / difyDatasetApiKey / difyDatasetId / difyDatasetMap`
- 对应测试及 env 示例中 `DIFY_*`

### 新增配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `SILICONFLOW_API_KEY` | — | 硅基流动密钥（secret） |
| `SILICONFLOW_BASE_URL` | `https://api.siliconflow.cn/v1` | 兼容 OpenAI 格式 |
| `RAG_DB_PATH` | `./data/rag.db` | sqlite-vec 索引文件 |
| `RAG_EMBEDDING_MODEL` | `BAAI/bge-m3` | embedding 模型名 |
| `RAG_EMBEDDING_DIM` | `1024` | 向量维度 |
| `RAG_SYNC_INTERVAL_MS` | `300000` | 5 min |

## 切换步骤（单 PR）

1. **NanoClaw 仓库**：新建 5 个 skill，对每个 skill 本地 dispatch 冒烟通过
2. **Gateway 仓库**（同一 PR 内完成加/删）：
   - 新增：`llm-embedding`, `rag-index`, `rag-search`, `workflow-callback`, 两条新路由, dispatch 表迁移
   - 删除：Dify 所有代码 + `/prd/chat` + `/rag/query` + `DIFY_*` 配置
   - 测试：删 Dify mock，加 sqlite-vec + 硅基流动 + callback 路由单测/契约测
3. **部署顺序（手动）**：
   - 先部署 NanoClaw（新 skill 上线，无流量）
   - 停 Gateway → `bun run rag:bootstrap` 首次全量索引 → 启动 Gateway
   - 端到端验证 5 条链路（PRD 多轮、Plane Approved、Review 通过、CI 回流、RAG 问答）
4. **直接下线 Dify**：停并删除 Dify 容器 + 数据卷 + 相关配置（无线上用户，无需保留）

## 测试策略

### 单元测试

- `rag-index`：分片边界（heading 拆分、800 token 上限）、增量 diff（新增/更新/删除）
- `rag-search`：KNN 排序、workspace 隔离、top_k 截断
- `workflow-callback`：4 条 skill 分派、`dispatch_id` 幂等、非法 `X-System-Secret` 拒绝
- `llm-embedding`：批量 32、失败退避重试 3 次、5 req/s 限流

### 契约测试

Mock NanoClaw 以真实 HTTP 向 Gateway `/api/workflow/callback` 发载荷，验证写 Git + 飞书通知 + Plane 更新的副作用。

### 手动冒烟

端到端走通 5 条主链路。

## 回滚预案

无线上用户，不设回滚方案。故障发生时直接在新架构上修复。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 硅基流动首次全量索引限流 | 5 req/s 客户端限流 + 批量 32 + 重试退避 |
| workspace 隔离漏检 | index/search 路径强制断言 `workspace_id` 非空 |
| opus-4-6 生成技术设计 > 2 min | Gateway callback 超时窗口 10 min，dispatch 表记 `timeout_at` |
| skill prompt 改动需发版 | 接受，作为该方案的固有代价；prompt 变更走 PR review |
| sqlite-vec 扩展加载失败 | 启动时 fail-fast + 明确错误日志；CI 固化 Bun 版本 + 扩展版本 |

## 非目标

- 不支持多向量模型并存（维度锁死 1024）
- 不做 prompt 在线热更新（接受发版代价）
- 不迁移 Dify 历史会话（PRD 多轮对话在 NanoClaw 重新开启）
