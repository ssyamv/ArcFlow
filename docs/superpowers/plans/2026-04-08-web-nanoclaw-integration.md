# Web 前端接入 NanoClaw 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web 前端替换 PrdChat 页面，直接接入 NanoClaw WebChannel，统一 AI 对话入口（知识问答、PRD 生成、任务管理、工作流触发）

**Architecture:** NanoClaw 新增 WebChannel（HTTP+SSE），实现 Channel 接口；Gateway 新增 RAG 查询端点供 arcflow-api 调用；Web 前端改造 PrdChat 为通用 Chat 页面，对接 NanoClaw WebChannel

**Tech Stack:** NanoClaw (TypeScript + Express 5)、Gateway (Bun + Hono)、Web (Vue 3 + Pinia + Tailwind CSS)

---

## 文件结构

### NanoClaw 仓库 (`/Users/chenqi/code/nanoclaw/`)

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/channels/web.ts` | WebChannel 实现 + 注册 |
| 创建 | `src/channels/web.test.ts` | WebChannel 单元测试 |
| 修改 | `src/channels/index.ts` | 添加 `import './web.js'` |
| 修改 | `.env.example` | 添加 WEB_CHANNEL_PORT、WEB_CHANNEL_CORS_ORIGIN |

### Gateway (`/Users/chenqi/code/ArcFlow/packages/gateway/`)

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/config.ts` | 添加 difyRagApiKey（已完成） |
| 修改 | `src/services/dify.ts` | 添加 queryKnowledgeBase() |
| 修改 | `src/services/dify.test.ts` | RAG 查询测试 |
| 修改 | `src/routes/api.ts` | 添加 POST /rag/query |
| 修改 | `src/routes/api.test.ts` | RAG 路由测试 |
| 修改 | `.env.example` | 添加 DIFY_RAG_API_KEY |

### Web 前端 (`/Users/chenqi/code/ArcFlow/packages/web/`)

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/api/chat.ts` | NanoClaw HTTP+SSE 客户端 |
| 创建 | `src/stores/chat.ts` | 通用聊天状态管理 |
| 创建 | `src/pages/Chat.vue` | 统一聊天页面 |
| 修改 | `src/router/index.ts` | /chat 路由 + /prd/chat 重定向 |
| 修改 | `src/components/AppLayout.vue` | 侧边栏导航改为"AI 助手" |
| 删除 | `src/pages/PrdChat.vue` | 被 Chat.vue 替代 |
| 删除 | `src/api/prd.ts` | 被 chat.ts 替代 |
| 删除 | `src/stores/prdChat.ts` | 被 chat.ts 替代 |

---

## Task 1: Gateway — RAG 查询服务

**Files:**

- Modify: `/Users/chenqi/code/ArcFlow/packages/gateway/src/services/dify.ts`
- Modify: `/Users/chenqi/code/ArcFlow/packages/gateway/src/services/dify.test.ts`

- [ ] **Step 1: 写失败测试 — queryKnowledgeBase**

在 `dify.test.ts` 末尾添加测试：

```typescript
describe("queryKnowledgeBase", () => {
  let capturedBody: any;

  beforeEach(() => {
    const fn = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      const headers = init.headers as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return new Response(
        JSON.stringify({
          answer: "用户登录接口定义在 api/user-auth.yaml",
          conversation_id: "conv-123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    globalThis.fetch = fn as unknown as typeof fetch;
  });

  it("uses difyRagApiKey and calls chat-messages endpoint", async () => {
    const result = await queryKnowledgeBase("用户登录接口在哪？");
    expect(capturedHeaders["Authorization"]).toBe("Bearer dify-rag-val");
    expect(capturedBody.query).toBe("用户登录接口在哪？");
    expect(capturedBody.response_mode).toBe("blocking");
    expect(result.answer).toBe("用户登录接口定义在 api/user-auth.yaml");
    expect(result.conversation_id).toBe("conv-123");
  });

  it("passes conversation_id for multi-turn", async () => {
    await queryKnowledgeBase("接着说", "conv-existing");
    expect(capturedBody.conversation_id).toBe("conv-existing");
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = (async () =>
      new Response("Internal Server Error", { status: 500 })) as unknown as typeof fetch;
    await expect(queryKnowledgeBase("test")).rejects.toThrow("Dify RAG API error: 500");
  });
});
```

- [ ] **Step 2: 更新 mock config 添加 difyRagApiKey**

在 `dify.test.ts` 顶部的 mock config 中添加：

```typescript
mock.module("../config", () => ({
  getConfig: () => ({
    difyBaseUrl: "http://dify-test:3001",
    difyApiKey: "dify-shared-val",
    difyTechDocApiKey: "dify-techdoc-val",
    difyOpenApiApiKey: "dify-openapi-val",
    difyBugAnalysisApiKey: "dify-bugfix-val",
    difyRagApiKey: "dify-rag-val",
  }),
}));
```

- [ ] **Step 3: 更新 import 语句**

在 `dify.test.ts` 的 import 行更新：

```typescript
const { generateTechDoc, generateOpenApi, analyzeBug, queryKnowledgeBase } = await import("./dify");
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd /Users/chenqi/code/ArcFlow/packages/gateway && bun test src/services/dify.test.ts`
Expected: FAIL — `queryKnowledgeBase` is not exported

- [ ] **Step 5: 实现 queryKnowledgeBase**

在 `dify.ts` 末尾添加：

```typescript
export interface RagQueryResult {
  answer: string;
  conversation_id: string;
}

export async function queryKnowledgeBase(
  question: string,
  conversationId?: string,
): Promise<RagQueryResult> {
  const config = getConfig();
  const url = `${config.difyBaseUrl}/v1/chat-messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.difyRagApiKey}`,
    },
    body: JSON.stringify({
      query: question,
      conversation_id: conversationId ?? "",
      response_mode: "blocking",
      user: "gateway-rag",
      inputs: {},
    }),
  });

  if (!res.ok) {
    throw new Error(`Dify RAG API error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as Record<string, string>;
  return {
    answer: json.answer ?? "",
    conversation_id: json.conversation_id ?? conversationId ?? "",
  };
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/chenqi/code/ArcFlow/packages/gateway && bun test src/services/dify.test.ts`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/gateway/src/services/dify.ts packages/gateway/src/services/dify.test.ts
git commit -m "feat(gateway): 添加 RAG 知识库查询服务 queryKnowledgeBase"
```

---

## Task 2: Gateway — RAG API 路由

**Files:**

- Modify: `/Users/chenqi/code/ArcFlow/packages/gateway/src/routes/api.ts`
- Modify: `/Users/chenqi/code/ArcFlow/packages/gateway/src/routes/api.test.ts`

- [ ] **Step 1: 写失败测试 — POST /api/rag/query**

在 `api.test.ts` 末尾添加：

```typescript
describe("rag routes", () => {
  it("POST /api/rag/query returns answer", async () => {
    const difyService = await import("../services/dify");
    const ragSpy = spyOn(difyService, "queryKnowledgeBase").mockResolvedValue({
      answer: "接口定义在 api/user.yaml",
      conversation_id: "conv-1",
    });

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "用户登录接口在哪？" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("接口定义在 api/user.yaml");
    expect(body.conversation_id).toBe("conv-1");
    expect(ragSpy).toHaveBeenCalledWith("用户登录接口在哪？", undefined);
  });

  it("POST /api/rag/query passes conversation_id", async () => {
    const difyService = await import("../services/dify");
    const ragSpy = spyOn(difyService, "queryKnowledgeBase").mockResolvedValue({
      answer: "继续回答",
      conversation_id: "conv-existing",
    });

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "接着说",
        conversation_id: "conv-existing",
      }),
    });
    expect(res.status).toBe(200);
    expect(ragSpy).toHaveBeenCalledWith("接着说", "conv-existing");
  });

  it("POST /api/rag/query returns 400 if question is empty", async () => {
    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("POST /api/rag/query returns 500 on service error", async () => {
    const difyService = await import("../services/dify");
    spyOn(difyService, "queryKnowledgeBase").mockRejectedValue(
      new Error("Dify RAG API error: 500"),
    );

    const res = await app.request("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("RAG");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/chenqi/code/ArcFlow/packages/gateway && bun test src/routes/api.test.ts`
Expected: FAIL — 404 on /api/rag/query

- [ ] **Step 3: 实现路由**

在 `api.ts` 顶部添加 import：

```typescript
import { queryKnowledgeBase } from "../services/dify";
```

在 `api.ts` 的 `apiRoutes.post("/prd/chat", ...)` 之后添加：

```typescript
apiRoutes.post("/rag/query", async (c) => {
  const { question, conversation_id } = await c.req.json<{
    question: string;
    conversation_id?: string;
  }>();

  if (!question?.trim()) {
    return c.json({ error: "question is required" }, 400);
  }

  try {
    const result = await queryKnowledgeBase(question, conversation_id);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `RAG query failed: ${err instanceof Error ? err.message : "unknown error"}` },
      500,
    );
  }
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/chenqi/code/ArcFlow/packages/gateway && bun test src/routes/api.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 更新 .env.example**

在 `packages/gateway/.env.example` 的 Dify 区块末尾添加：

```env
# Dify RAG 知识库问答（工作流四）
DIFY_RAG_API_KEY=
```

- [ ] **Step 6: 运行全量测试**

Run: `cd /Users/chenqi/code/ArcFlow/packages/gateway && bun test`
Expected: 全部通过（171+ 测试）

- [ ] **Step 7: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/gateway/src/routes/api.ts packages/gateway/src/routes/api.test.ts packages/gateway/src/config.ts packages/gateway/.env.example
git commit -m "feat(gateway): 添加 POST /api/rag/query RAG 知识库查询端点"
```

---

## Task 3: NanoClaw — WebChannel 实现

**Files:**

- Create: `/Users/chenqi/code/nanoclaw/src/channels/web.ts`
- Create: `/Users/chenqi/code/nanoclaw/src/channels/web.test.ts`
- Modify: `/Users/chenqi/code/nanoclaw/src/channels/index.ts`
- Modify: `/Users/chenqi/code/nanoclaw/.env.example`

- [ ] **Step 1: 写失败测试**

创建 `/Users/chenqi/code/nanoclaw/src/channels/web.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock env and logger before importing
vi.mock('../env.js', () => ({
  readEnvFile: () => ({}),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'ArcFlow',
}));

describe('WebChannel', () => {
  let WebChannel: any;
  let registerChannel: any;

  beforeEach(async () => {
    // Set env before import
    process.env.WEB_CHANNEL_PORT = '0'; // random port
    const mod = await import('./web.js');
    WebChannel = mod.WebChannel;
  });

  afterEach(() => {
    delete process.env.WEB_CHANNEL_PORT;
    delete process.env.WEB_CHANNEL_CORS_ORIGIN;
  });

  it('has name "web"', () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0,
    );
    expect(channel.name).toBe('web');
  });

  it('ownsJid returns true for web: prefix', () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0,
    );
    expect(channel.ownsJid('web:user-123')).toBe(true);
    expect(channel.ownsJid('feishu:chat-456')).toBe(false);
  });

  it('connect starts HTTP server and disconnect stops it', async () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0, // port 0 = random available port
    );
    await channel.connect();
    expect(channel.isConnected()).toBe(true);
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('POST /api/chat accepts message and calls onMessage', async () => {
    const onMessage = vi.fn();
    const onChatMetadata = vi.fn();
    const channel = new WebChannel(
      { onMessage, onChatMetadata, registeredGroups: () => ({}) },
      0,
    );
    await channel.connect();

    const port = channel.getPort();
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'user-1', message: 'hello' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message_id).toBeDefined();

    expect(onMessage).toHaveBeenCalledTimes(1);
    const [jid, msg] = onMessage.mock.calls[0];
    expect(jid).toBe('web:user-1');
    expect(msg.content).toContain('hello');

    expect(onChatMetadata).toHaveBeenCalledTimes(1);
    const [metaJid, , , metaChannel] = onChatMetadata.mock.calls[0];
    expect(metaJid).toBe('web:user-1');
    expect(metaChannel).toBe('web');

    await channel.disconnect();
  });

  it('POST /api/chat returns 400 if client_id or message missing', async () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0,
    );
    await channel.connect();
    const port = channel.getPort();

    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'user-1' }),
    });
    expect(res.status).toBe(400);

    await channel.disconnect();
  });

  it('sendMessage pushes to SSE client', async () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0,
    );
    await channel.connect();
    const port = channel.getPort();

    // Establish SSE connection
    const sseResponse = await fetch(`http://localhost:${port}/api/chat/sse?client_id=user-1`);
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Send message via channel
    await channel.sendMessage('web:user-1', 'Hello from agent');

    // Read SSE data
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('event: message');
    expect(text).toContain('Hello from agent');

    reader.cancel();
    await channel.disconnect();
  });

  it('GET /health returns ok', async () => {
    const channel = new WebChannel(
      { onMessage: vi.fn(), onChatMetadata: vi.fn(), registeredGroups: () => ({}) },
      0,
    );
    await channel.connect();
    const port = channel.getPort();

    const res = await fetch(`http://localhost:${port}/health`);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.channel).toBe('web');

    await channel.disconnect();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/chenqi/code/nanoclaw && npx vitest run src/channels/web.test.ts`
Expected: FAIL — `./web.js` module not found

- [ ] **Step 3: 实现 WebChannel**

创建 `/Users/chenqi/code/nanoclaw/src/channels/web.ts`：

```typescript
import express, { Request, Response } from 'express';
import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { ASSISTANT_NAME } from '../config.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel } from '../types.js';

export class WebChannel implements Channel {
  name = 'web';

  private opts: ChannelOpts;
  private port: number;
  private corsOrigin: string;
  private server: http.Server | null = null;
  private sseClients = new Map<string, Response>();
  private connected = false;

  constructor(opts: ChannelOpts, port: number, corsOrigin = '*') {
    this.opts = opts;
    this.port = port;
    this.corsOrigin = corsOrigin;
  }

  async connect(): Promise<void> {
    const app = express();
    app.use(express.json());

    // CORS middleware
    app.use((_req: Request, res: Response, next) => {
      res.header('Access-Control-Allow-Origin', this.corsOrigin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (_req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });

    // POST /api/chat — receive user message
    app.post('/api/chat', (req: Request, res: Response) => {
      const { client_id, message } = req.body;

      if (!client_id || !message?.trim()) {
        res.status(400).json({ error: 'client_id and message are required' });
        return;
      }

      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const chatJid = `web:${client_id}`;
      const timestamp = new Date().toISOString();

      // Deliver metadata
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        `web-${client_id}`,
        'web',
        false,
      );

      // Deliver message to NanoClaw container
      this.opts.onMessage(chatJid, {
        id: messageId,
        chat_jid: chatJid,
        sender: client_id,
        sender_name: client_id,
        content: `@${ASSISTANT_NAME} ${message.trim()}`,
        timestamp,
      });

      logger.info({ chatJid, messageId }, 'WebChannel: message received');
      res.json({ ok: true, message_id: messageId });
    });

    // GET /api/chat/sse — SSE connection for receiving agent replies
    app.get('/api/chat/sse', (req: Request, res: Response) => {
      const clientId = req.query.client_id as string;
      if (!clientId) {
        res.status(400).json({ error: 'client_id query param is required' });
        return;
      }

      // Close existing SSE connection for this client
      const existing = this.sseClients.get(clientId);
      if (existing && !existing.writableEnded) {
        existing.end();
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': this.corsOrigin,
      });

      // Send initial ping
      res.write('event: ping\ndata: {}\n\n');

      this.sseClients.set(clientId, res);
      logger.info({ clientId }, 'WebChannel: SSE client connected');

      req.on('close', () => {
        this.sseClients.delete(clientId);
        logger.info({ clientId }, 'WebChannel: SSE client disconnected');
      });
    });

    // Health check
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', channel: 'web', clients: this.sseClients.size });
    });

    await new Promise<void>((resolve) => {
      this.server = app.listen(this.port, () => {
        // Update port in case 0 was used (random port)
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        logger.info({ port: this.port }, 'WebChannel: HTTP server started');
        resolve();
      });
    });

    this.connected = true;
    logger.info('WebChannel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const clientId = jid.replace(/^web:/, '');
    const sseRes = this.sseClients.get(clientId);

    if (!sseRes || sseRes.writableEnded) {
      logger.warn({ jid }, 'WebChannel: no SSE client found, message dropped');
      return;
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = JSON.stringify({ message_id: messageId, content: text, done: true });

    sseRes.write(`event: message\ndata: ${data}\n\n`);
    logger.info({ jid, messageId }, 'WebChannel: message sent via SSE');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const clientId = jid.replace(/^web:/, '');
    const sseRes = this.sseClients.get(clientId);

    if (!sseRes || sseRes.writableEnded) return;

    const data = JSON.stringify({ is_typing: isTyping });
    sseRes.write(`event: typing\ndata: ${data}\n\n`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    // Close all SSE connections
    for (const [, res] of this.sseClients) {
      if (!res.writableEnded) res.end();
    }
    this.sseClients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.connected = false;
    logger.info('WebChannel disconnected');
  }

  /** Expose actual port (useful when constructed with port=0 for tests) */
  getPort(): number {
    return this.port;
  }
}

// Self-register
registerChannel('web', (opts: ChannelOpts) => {
  const envVars = readEnvFile([
    'WEB_CHANNEL_PORT',
    'WEB_CHANNEL_CORS_ORIGIN',
  ]);

  const port = parseInt(
    process.env.WEB_CHANNEL_PORT || envVars.WEB_CHANNEL_PORT || '',
    10,
  );
  const corsOrigin =
    process.env.WEB_CHANNEL_CORS_ORIGIN ||
    envVars.WEB_CHANNEL_CORS_ORIGIN ||
    '*';

  if (!port) {
    logger.warn('WebChannel: WEB_CHANNEL_PORT not set, skipping');
    return null;
  }

  return new WebChannel(opts, port, corsOrigin);
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/chenqi/code/nanoclaw && npx vitest run src/channels/web.test.ts`
Expected: ALL PASS

- [ ] **Step 5: 注册 Channel**

修改 `/Users/chenqi/code/nanoclaw/src/channels/index.ts`，在 `import './feishu.js';` 之后添加：

```typescript
// web
import './web.js';
```

- [ ] **Step 6: 更新 .env.example**

在 `/Users/chenqi/code/nanoclaw/.env.example` 末尾添加：

```env

# --- Web Channel ---
WEB_CHANNEL_PORT=3001
WEB_CHANNEL_CORS_ORIGIN=*
```

- [ ] **Step 7: 提交**

```bash
cd /Users/chenqi/code/nanoclaw
git add src/channels/web.ts src/channels/web.test.ts src/channels/index.ts .env.example
git commit -m "feat: 添加 WebChannel — Web 前端 HTTP+SSE 接入"
```

---

## Task 4: Web 前端 — API 层

**Files:**

- Create: `/Users/chenqi/code/ArcFlow/packages/web/src/api/chat.ts`

- [ ] **Step 1: 创建 chat.ts**

```typescript
const NANOCLAW_BASE = import.meta.env.VITE_NANOCLAW_BASE ?? "";

export interface ChatMessageEvent {
  message_id: string;
  content: string;
  done: boolean;
}

export interface ChatTypingEvent {
  is_typing: boolean;
}

export interface ChatErrorEvent {
  message: string;
}

export type ChatSSEHandler = {
  onMessage: (data: ChatMessageEvent) => void;
  onTyping?: (data: ChatTypingEvent) => void;
  onError: (data: ChatErrorEvent) => void;
};

export async function sendChatMessage(
  clientId: string,
  message: string,
): Promise<{ ok: boolean; message_id: string }> {
  const res = await fetch(`${NANOCLAW_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, message }),
  });

  if (!res.ok) {
    throw new Error(`发送失败: ${res.status}`);
  }

  return res.json();
}

export function connectSSE(clientId: string, handlers: ChatSSEHandler): EventSource {
  const es = new EventSource(`${NANOCLAW_BASE}/api/chat/sse?client_id=${clientId}`);

  es.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data) as ChatMessageEvent;
      handlers.onMessage(data);
    } catch {
      // skip malformed
    }
  });

  es.addEventListener("typing", (e) => {
    try {
      const data = JSON.parse(e.data) as ChatTypingEvent;
      handlers.onTyping?.(data);
    } catch {
      // skip
    }
  });

  es.addEventListener("error", (e) => {
    if (e instanceof MessageEvent && e.data) {
      try {
        const data = JSON.parse(e.data) as ChatErrorEvent;
        handlers.onError(data);
      } catch {
        handlers.onError({ message: "连接错误" });
      }
    }
  });

  return es;
}
```

- [ ] **Step 2: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/web/src/api/chat.ts
git commit -m "feat(web): 添加 NanoClaw chat API 客户端"
```

---

## Task 5: Web 前端 — Store

**Files:**

- Create: `/Users/chenqi/code/ArcFlow/packages/web/src/stores/chat.ts`

- [ ] **Step 1: 创建 chat.ts**

```typescript
import { defineStore } from "pinia";
import { ref, onUnmounted } from "vue";
import { sendChatMessage, connectSSE, type ChatSSEHandler } from "../api/chat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const typing = ref(false);
  const error = ref<string | null>(null);
  const clientId = ref(`client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  let eventSource: EventSource | null = null;
  let pendingAssistantMsg: ChatMessage | null = null;

  function addMessage(role: "user" | "assistant", content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  function ensureSSE() {
    if (eventSource) return;

    const handlers: ChatSSEHandler = {
      onMessage(data) {
        typing.value = false;
        loading.value = false;

        if (pendingAssistantMsg) {
          pendingAssistantMsg.content = data.content;
          pendingAssistantMsg = null;
        } else {
          addMessage("assistant", data.content);
        }
      },
      onTyping(data) {
        typing.value = data.is_typing;
      },
      onError(data) {
        error.value = data.message;
        loading.value = false;
        typing.value = false;
      },
    };

    eventSource = connectSSE(clientId.value, handlers);
  }

  async function send(message: string) {
    if (loading.value || !message.trim()) return;

    error.value = null;
    loading.value = true;

    addMessage("user", message);
    pendingAssistantMsg = addMessage("assistant", "");

    ensureSSE();

    try {
      await sendChatMessage(clientId.value, message);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "发送失败";
      loading.value = false;
      // Remove empty assistant message
      if (pendingAssistantMsg && !pendingAssistantMsg.content) {
        const idx = messages.value.indexOf(pendingAssistantMsg);
        if (idx !== -1) messages.value.splice(idx, 1);
      }
      pendingAssistantMsg = null;
    }
  }

  function reset() {
    messages.value = [];
    loading.value = false;
    typing.value = false;
    error.value = null;
    pendingAssistantMsg = null;

    // Close and reconnect SSE with new client ID
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clientId.value = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cleanup() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return { messages, loading, typing, error, clientId, send, reset, cleanup };
});
```

- [ ] **Step 2: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/web/src/stores/chat.ts
git commit -m "feat(web): 添加通用 chat store（NanoClaw 对话状态管理）"
```

---

## Task 6: Web 前端 — Chat 页面 + 路由

**Files:**

- Create: `/Users/chenqi/code/ArcFlow/packages/web/src/pages/Chat.vue`
- Modify: `/Users/chenqi/code/ArcFlow/packages/web/src/router/index.ts`
- Modify: `/Users/chenqi/code/ArcFlow/packages/web/src/components/AppLayout.vue`
- Delete: `/Users/chenqi/code/ArcFlow/packages/web/src/pages/PrdChat.vue`
- Delete: `/Users/chenqi/code/ArcFlow/packages/web/src/api/prd.ts`
- Delete: `/Users/chenqi/code/ArcFlow/packages/web/src/stores/prdChat.ts`

- [ ] **Step 1: 创建 Chat.vue**

创建 `/Users/chenqi/code/ArcFlow/packages/web/src/pages/Chat.vue`：

```vue
<script setup lang="ts">
import { ref, nextTick, watch, onUnmounted } from "vue";
import { marked } from "marked";
import { useChatStore } from "../stores/chat";

marked.setOptions({ breaks: true });

function renderMd(text: string): string {
  return marked.parse(text) as string;
}

const store = useChatStore();
const input = ref("");
const chatContainer = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

watch(() => store.messages.length, scrollToBottom);
watch(() => store.messages.at(-1)?.content, scrollToBottom);

async function handleSend() {
  const msg = input.value.trim();
  if (!msg || store.loading) return;
  input.value = "";
  await store.send(msg);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleNewChat() {
  store.reset();
  input.value = "";
}

onUnmounted(() => {
  store.cleanup();
});
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-3rem)] max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between pb-4 border-b border-gray-200">
      <div>
        <h1 class="text-xl font-semibold text-gray-900 m-0">AI 助手</h1>
        <p class="text-sm text-gray-500 mt-1 m-0">知识问答、PRD 生成、任务管理、工作流触发</p>
      </div>
      <button
        class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        @click="handleNewChat"
      >
        新建对话
      </button>
    </div>

    <!-- Chat Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto py-4 space-y-4">
      <!-- Welcome message when empty -->
      <div v-if="store.messages.length === 0" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium shrink-0"
        >
          AI
        </div>
        <div class="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 max-w-[80%]">
          <p class="m-0 text-gray-700">
            你好！我是 ArcFlow AI 助手，可以帮你：
          </p>
          <ul class="mt-2 mb-0 text-gray-600 text-sm space-y-1">
            <li>查询项目知识库</li>
            <li>生成 PRD 文档</li>
            <li>管理 Plane 任务</li>
            <li>触发工作流</li>
          </ul>
        </div>
      </div>

      <!-- Messages -->
      <div
        v-for="msg in store.messages"
        :key="msg.id"
        class="flex items-start gap-3"
        :class="msg.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <!-- Avatar -->
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
          :class="msg.role === 'user' ? 'bg-slate-700' : 'bg-indigo-600'"
        >
          {{ msg.role === "user" ? "You" : "AI" }}
        </div>
        <!-- Bubble -->
        <div
          class="rounded-lg px-4 py-3 max-w-[80%]"
          :class="
            msg.role === 'user'
              ? 'bg-indigo-600 text-white'
              : 'bg-white shadow-sm border border-gray-100 text-gray-700'
          "
        >
          <div
            v-if="msg.role === 'assistant' && msg.content"
            class="prose prose-sm max-w-none"
            v-html="renderMd(msg.content)"
          />
          <p v-else-if="msg.role === 'user'" class="m-0 whitespace-pre-wrap">{{ msg.content }}</p>
          <p
            v-if="msg.role === 'assistant' && !msg.content && store.loading"
            class="m-0 text-gray-400"
          >
            思考中...
          </p>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="store.typing" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium shrink-0"
        >
          AI
        </div>
        <div class="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100">
          <p class="m-0 text-gray-400">正在输入...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-if="store.error" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white text-sm shrink-0"
        >
          !
        </div>
        <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-[80%]">
          <p class="m-0 text-red-700">{{ store.error }}</p>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="border-t border-gray-200 pt-4">
      <div class="flex gap-2">
        <textarea
          v-model="input"
          :disabled="store.loading"
          placeholder="输入你的问题..."
          rows="2"
          class="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
          @keydown="handleKeydown"
        />
        <button
          :disabled="store.loading || !input.trim()"
          class="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          @click="handleSend"
        >
          {{ store.loading ? "等待中..." : "发送" }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 更新路由**

修改 `/Users/chenqi/code/ArcFlow/packages/web/src/router/index.ts`，将 PrdChat 路由替换为 Chat：

将：

```typescript
    {
      path: "/prd/chat",
      name: "prd-chat",
      component: () => import("../pages/PrdChat.vue"),
    },
```

替换为：

```typescript
    {
      path: "/chat",
      name: "chat",
      component: () => import("../pages/Chat.vue"),
    },
    {
      path: "/prd/chat",
      redirect: "/chat",
    },
```

- [ ] **Step 3: 更新侧边栏导航**

修改 `/Users/chenqi/code/ArcFlow/packages/web/src/components/AppLayout.vue`，将 PRD 生成链接改为 AI 助手：

将：

```html
          <router-link
            to="/prd/chat"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            PRD 生成
          </router-link>
```

替换为：

```html
          <router-link
            to="/chat"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            AI 助手
          </router-link>
```

- [ ] **Step 4: 删除旧文件**

```bash
cd /Users/chenqi/code/ArcFlow
rm packages/web/src/pages/PrdChat.vue
rm packages/web/src/api/prd.ts
rm packages/web/src/stores/prdChat.ts
```

- [ ] **Step 5: 验证前端构建**

Run: `cd /Users/chenqi/code/ArcFlow/packages/web && npm run build`
Expected: 构建成功，无错误

- [ ] **Step 6: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/web/src/pages/Chat.vue packages/web/src/router/index.ts packages/web/src/components/AppLayout.vue
git rm packages/web/src/pages/PrdChat.vue packages/web/src/api/prd.ts packages/web/src/stores/prdChat.ts
git commit -m "feat(web): 替换 PrdChat 为统一 AI 助手聊天页面，接入 NanoClaw WebChannel"
```

---

## Task 7: 更新环境配置和文档

**Files:**

- Modify: `/Users/chenqi/code/ArcFlow/packages/web/.env.example` (如果存在) 或创建
- Modify: `/Users/chenqi/code/ArcFlow/CLAUDE.md`

- [ ] **Step 1: Web 前端环境变量**

检查 `packages/web/` 下是否有 `.env.example`，如果没有则创建：

```env
# NanoClaw WebChannel 地址
VITE_NANOCLAW_BASE=http://localhost:3001
```

如果已有 `.env.example`，在末尾添加上面的内容。

- [ ] **Step 2: 更新 CLAUDE.md 设计规格文档索引**

在 `/Users/chenqi/code/ArcFlow/CLAUDE.md` 的设计规格文档索引表格末尾添加：

```markdown
| `2026-04-08-web-nanoclaw-integration-design.md` | Web 前端接入 NanoClaw WebChannel 设计 |
```

- [ ] **Step 3: 提交**

```bash
cd /Users/chenqi/code/ArcFlow
git add packages/web/.env.example CLAUDE.md docs/superpowers/specs/2026-04-08-web-nanoclaw-integration-design.md docs/superpowers/plans/2026-04-08-web-nanoclaw-integration.md
git commit -m "docs: Web + NanoClaw 集成设计规格 + 实施计划 + 环境配置"
```
