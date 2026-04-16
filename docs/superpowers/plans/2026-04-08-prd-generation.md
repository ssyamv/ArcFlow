> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# PRD 智能生成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ArcFlow Web 中新增对话式 PRD 生成页面，PM 通过对话描述需求，AI 引导收集信息后自动生成 PRD 写入 docs Git 仓库。

**Architecture:** Web 前端提供对话 UI，通过 SSE 与 Gateway 通信。Gateway 透传消息到 Dify Chatflow（Opus），Chatflow 负责多轮对话引导和 PRD 生成。Gateway 识别生成完成信号后写入 docs Git 并触发 Wiki.js 同步。

**Tech Stack:** Bun + Hono (Gateway SSE)、Dify Chatflow API (streaming)、Vue 3 + Tailwind CSS (Web 前端)、simple-git (Git 写入)

---

## 文件结构

### Gateway (packages/gateway)

| 文件 | 职责 |
|------|------|
| `src/config.ts` | 新增 `difyPrdGenApiKey` 配置 |
| `src/services/prd.ts` | PRD 核心逻辑：Dify SSE 解析、完成信号识别、Git 写入 |
| `src/services/prd.test.ts` | PRD 服务测试 |
| `src/routes/api.ts` | 新增 `POST /api/prd/chat` SSE 路由 |

### Web 前端 (packages/web)

| 文件 | 职责 |
|------|------|
| `src/api/prd.ts` | PRD 对话 API（SSE fetch） |
| `src/stores/prdChat.ts` | 对话状态管理（消息列表、conversation_id、loading） |
| `src/pages/PrdChat.vue` | 对话页面 |
| `src/router/index.ts` | 新增路由 `/prd/chat` |
| `src/components/AppLayout.vue` | 导航栏新增"PRD 生成"入口 |

### Dify

| 资源 | 职责 |
|------|------|
| `setup/dify/prd-gen-chatflow.yml` | PRD 生成 Chatflow DSL |

---

### Task 1: Gateway — config 新增 difyPrdGenApiKey

**Files:**

- Modify: `packages/gateway/src/config.ts:1-103`

- [ ] **Step 1: 在 Config interface 中新增字段**

在 `config.ts` 的 `Config` interface 中，`claudeCodeTimeout` 之前新增：

```typescript
  // PRD 生成
  difyPrdGenApiKey: string;
```text

- [ ] **Step 2: 在 getConfig() 中新增环境变量读取**

在 `getConfig()` 函数中，`claudeCodeTimeout` 行之前新增：

```typescript
    difyPrdGenApiKey: process.env.DIFY_PRD_GEN_API_KEY ?? process.env.DIFY_API_KEY ?? "",
```text

- [ ] **Step 3: 运行现有测试确保无回归**

Run: `cd packages/gateway && bun test`
Expected: 171 tests pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/config.ts
git commit -m "feat(gateway): config 新增 difyPrdGenApiKey"
```text

---

### Task 2: Gateway — PRD 服务核心逻辑（测试先行）

**Files:**
- Create: `packages/gateway/src/services/prd.ts`
- Create: `packages/gateway/src/services/prd.test.ts`

- [ ] **Step 1: 编写 PRD 信号提取的测试**

创建 `packages/gateway/src/services/prd.test.ts`：

```typescript
import { describe, expect, it } from "bun:test";
import { extractPrdResult, buildPrdFilePath, buildWikiUrl } from "./prd";

describe("extractPrdResult", () => {
  it("should extract PRD JSON from marked text", () => {
    const text = `PRD 已生成！
<<<PRD_OUTPUT>>>
{"action":"prd_generated","prd_type":"feature","filename":"sms-login","title":"手机验证码登录","content":"---\\ntitle: 手机验证码登录\\n---"}
<<<END_PRD_OUTPUT>>>`;

    const result = extractPrdResult(text);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("prd_generated");
    expect(result!.filename).toBe("sms-login");
    expect(result!.title).toBe("手机验证码登录");
    expect(result!.prd_type).toBe("feature");
    expect(result!.content).toContain("title: 手机验证码登录");
  });

  it("should return null when no marker found", () => {
    const text = "普通对话回复，没有 PRD 输出";
    expect(extractPrdResult(text)).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    const text = "<<<PRD_OUTPUT>>>\n{invalid json}\n<<<END_PRD_OUTPUT>>>";
    expect(extractPrdResult(text)).toBeNull();
  });
});

describe("buildPrdFilePath", () => {
  it("should build correct path with current year-month", () => {
    const path = buildPrdFilePath("sms-login");
    // Format: prd/YYYY-MM/sms-login.md
    expect(path).toMatch(/^prd\/\d{4}-\d{2}\/sms-login\.md$/);
  });
});

describe("buildWikiUrl", () => {
  it("should build Wiki.js URL from file path", () => {
    const url = buildWikiUrl("http://172.29.230.21:3000", "prd/2026-04/sms-login.md");
    expect(url).toBe("http://172.29.230.21:3000/prd/2026-04/sms-login");
  });

  it("should handle trailing slash in base URL", () => {
    const url = buildWikiUrl("http://172.29.230.21:3000/", "prd/2026-04/sms-login.md");
    expect(url).toBe("http://172.29.230.21:3000/prd/2026-04/sms-login");
  });
});
```text

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/prd.test.ts`
Expected: FAIL — module `./prd` not found

- [ ] **Step 3: 实现纯函数**

创建 `packages/gateway/src/services/prd.ts`：

```typescript
import { getConfig } from "../config";
import { ensureRepo, writeAndPush } from "./git";
import { triggerSync } from "./wikijs";

export interface PrdResult {
  action: "prd_generated";
  prd_type: "feature" | "module";
  filename: string;
  title: string;
  content: string;
}

const PRD_MARKER_START = "<<<PRD_OUTPUT>>>";
const PRD_MARKER_END = "<<<END_PRD_OUTPUT>>>";

export function extractPrdResult(text: string): PrdResult | null {
  const regex = new RegExp(
    `${PRD_MARKER_START}([\\s\\S]*?)${PRD_MARKER_END}`,
  );
  const match = text.match(regex);
  if (!match) return null;

  try {
    return JSON.parse(match[1].trim()) as PrdResult;
  } catch {
    return null;
  }
}

export function buildPrdFilePath(filename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `prd/${year}-${month}/${filename}.md`;
}

export function buildWikiUrl(baseUrl: string, filePath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = filePath.replace(/\.md$/, "");
  return `${base}/${path}`;
}

export function containsPrdMarker(text: string): boolean {
  return text.includes(PRD_MARKER_START);
}

export function textBeforeMarker(text: string): string {
  const idx = text.indexOf(PRD_MARKER_START);
  if (idx === -1) return text;
  return text.substring(0, idx);
}

export async function savePrdToGit(result: PrdResult): Promise<{ path: string; wikiUrl: string }> {
  const config = getConfig();
  const path = buildPrdFilePath(result.filename);

  await ensureRepo("docs");
  await writeAndPush("docs", path, result.content, `feat(prd): 新增 ${result.title} PRD`);

  triggerSync().catch(() => {});

  const wikiUrl = buildWikiUrl(config.wikijsBaseUrl, path);
  return { path, wikiUrl };
}
```text

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/prd.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/prd.ts packages/gateway/src/services/prd.test.ts
git commit -m "feat(gateway): PRD 信号提取 + 路径构造 + Git 写入"
```text

---

### Task 3: Gateway — Dify Chatflow SSE 解析（测试先行）

**Files:**
- Modify: `packages/gateway/src/services/prd.ts`
- Modify: `packages/gateway/src/services/prd.test.ts`

- [ ] **Step 1: 编写 Dify SSE chunk 解析测试**

在 `prd.test.ts` 尾部追加：

```typescript
import { parseDifySSEChunk } from "./prd";

describe("parseDifySSEChunk", () => {
  it("should parse message event", () => {
    const line = `data: {"event":"message","message_id":"msg1","conversation_id":"conv1","answer":"你好","created_at":1234567890}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("message");
    expect(chunk!.answer).toBe("你好");
    expect(chunk!.conversation_id).toBe("conv1");
  });

  it("should parse message_end event", () => {
    const line = `data: {"event":"message_end","message_id":"msg1","conversation_id":"conv1","metadata":{}}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("message_end");
  });

  it("should return null for non-data lines", () => {
    expect(parseDifySSEChunk("event: message")).toBeNull();
    expect(parseDifySSEChunk("")).toBeNull();
    expect(parseDifySSEChunk(": comment")).toBeNull();
  });

  it("should return null for ping event", () => {
    const line = `data: {"event":"ping"}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("ping");
  });
});
```text

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/services/prd.test.ts`
Expected: FAIL — `parseDifySSEChunk` not found

- [ ] **Step 3: 实现 Dify SSE chunk 解析**

在 `prd.ts` 中 `savePrdToGit` 函数之后追加：

```typescript
export interface DifySSEChunk {
  event: "message" | "message_end" | "message_replace" | "error" | "ping";
  message_id?: string;
  conversation_id?: string;
  answer?: string;
  metadata?: Record<string, unknown>;
}

export function parseDifySSEChunk(line: string): DifySSEChunk | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as DifySSEChunk;
  } catch {
    return null;
  }
}

export async function* streamDifyChatflow(
  message: string,
  conversationId?: string,
): AsyncGenerator<DifySSEChunk> {
  const config = getConfig();
  const response = await fetch(`${config.difyBaseUrl}/v1/chat-messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.difyPrdGenApiKey}`,
    },
    body: JSON.stringify({
      query: message,
      conversation_id: conversationId ?? "",
      response_mode: "streaming",
      user: "pm",
      inputs: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Dify Chatflow API error: ${response.status} ${await response.text()}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk = parseDifySSEChunk(trimmed);
      if (chunk && chunk.event !== "ping") {
        yield chunk;
      }
    }
  }

  if (buffer.trim()) {
    const chunk = parseDifySSEChunk(buffer.trim());
    if (chunk && chunk.event !== "ping") {
      yield chunk;
    }
  }
}
```text

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/services/prd.test.ts`
Expected: 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/prd.ts packages/gateway/src/services/prd.test.ts
git commit -m "feat(gateway): Dify Chatflow SSE 解析器"
```text

---

### Task 4: Gateway — SSE 路由 POST /api/prd/chat

**Files:**
- Modify: `packages/gateway/src/routes/api.ts`

- [ ] **Step 1: 在 api.ts 顶部新增 import**

在 `api.ts` 的 import 区块追加：

```typescript
import { streamSSE } from "hono/streaming";
import {
  streamDifyChatflow,
  extractPrdResult,
  containsPrdMarker,
  textBeforeMarker,
  savePrdToGit,
} from "../services/prd";
```text

- [ ] **Step 2: 在 api.ts 末尾（最后一个路由之后）新增 SSE 路由**

在文件末尾 `});` 之前追加：

```typescript
apiRoutes.post("/prd/chat", async (c) => {
  const { message, conversation_id } = await c.req.json<{
    message: string;
    conversation_id?: string;
  }>();

  if (!message?.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    let fullAnswer = "";
    let convId = conversation_id ?? "";
    let markerDetected = false;

    try {
      for await (const chunk of streamDifyChatflow(message, conversation_id)) {
        if (chunk.event === "message" && chunk.answer) {
          convId = convId || chunk.conversation_id || "";
          fullAnswer += chunk.answer;

          if (markerDetected) continue;

          if (containsPrdMarker(fullAnswer)) {
            const before = textBeforeMarker(chunk.answer);
            if (before) {
              await stream.writeSSE({
                event: "message",
                data: JSON.stringify({
                  type: "text",
                  content: before,
                  conversation_id: convId,
                }),
              });
            }
            markerDetected = true;
            continue;
          }

          await stream.writeSSE({
            event: "message",
            data: JSON.stringify({
              type: "text",
              content: chunk.answer,
              conversation_id: convId,
            }),
          });
        }

        if (chunk.event === "message_end") {
          const prdResult = extractPrdResult(fullAnswer);
          if (prdResult) {
            try {
              const { path, wikiUrl } = await savePrdToGit(prdResult);
              await stream.writeSSE({
                event: "prd_complete",
                data: JSON.stringify({
                  prd_path: path,
                  wiki_url: wikiUrl,
                  title: prdResult.title,
                }),
              });
            } catch (err) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  message: `PRD 写入失败: ${err instanceof Error ? err.message : "未知错误"}`,
                }),
              });
            }
          }
        }
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: `对话失败: ${err instanceof Error ? err.message : "未知错误"}`,
        }),
      });
    }
  });
});
```text

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `cd packages/gateway && bun test`
Expected: All tests pass (原有 171 + 新增 9 = 180 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/routes/api.ts
git commit -m "feat(gateway): POST /api/prd/chat SSE 路由"
```text

---

### Task 5: Web 前端 — PRD 对话 API 层

**Files:**
- Create: `packages/web/src/api/prd.ts`

- [ ] **Step 1: 创建 PRD API 文件**

创建 `packages/web/src/api/prd.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface PrdMessageEvent {
  type: "text";
  content: string;
  conversation_id?: string;
}

export interface PrdCompleteEvent {
  prd_path: string;
  wiki_url: string;
  title: string;
}

export interface PrdErrorEvent {
  message: string;
}

export type PrdSSEHandler = {
  onMessage: (data: PrdMessageEvent) => void;
  onComplete: (data: PrdCompleteEvent) => void;
  onError: (data: PrdErrorEvent) => void;
};

export async function sendPrdChat(
  message: string,
  conversationId: string | undefined,
  handlers: PrdSSEHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/prd/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (currentEvent === "message" || (!currentEvent && parsed.type === "text")) {
            handlers.onMessage(parsed as PrdMessageEvent);
          } else if (currentEvent === "prd_complete") {
            handlers.onComplete(parsed as PrdCompleteEvent);
          } else if (currentEvent === "error") {
            handlers.onError(parsed as PrdErrorEvent);
          }
        } catch {
          // skip malformed JSON
        }
        currentEvent = "";
      }
    }
  }
}
```text

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/api/prd.ts
git commit -m "feat(web): PRD 对话 API 层（SSE fetch）"
```text

---

### Task 6: Web 前端 — Pinia Store

**Files:**
- Create: `packages/web/src/stores/prdChat.ts`

- [ ] **Step 1: 创建 PRD 对话 Store**

创建 `packages/web/src/stores/prdChat.ts`：

```typescript
import { defineStore } from "pinia";
import { ref } from "vue";
import { sendPrdChat, type PrdCompleteEvent } from "../api/prd";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface PrdGenResult {
  prdPath: string;
  wikiUrl: string;
  title: string;
}

export const usePrdChatStore = defineStore("prdChat", () => {
  const messages = ref<ChatMessage[]>([]);
  const conversationId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const prdResult = ref<PrdGenResult | null>(null);
  const abortController = ref<AbortController | null>(null);

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

  async function send(message: string) {
    if (loading.value || !message.trim()) return;

    error.value = null;
    loading.value = true;

    addMessage("user", message);

    const assistantMsg = addMessage("assistant", "");
    abortController.value = new AbortController();

    try {
      await sendPrdChat(message, conversationId.value, {
        onMessage(data) {
          assistantMsg.content += data.content;
          if (data.conversation_id && !conversationId.value) {
            conversationId.value = data.conversation_id;
          }
        },
        onComplete(data: PrdCompleteEvent) {
          prdResult.value = {
            prdPath: data.prd_path,
            wikiUrl: data.wiki_url,
            title: data.title,
          };
        },
        onError(data) {
          error.value = data.message;
        },
      }, abortController.value.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        error.value = e instanceof Error ? e.message : "发送失败";
      }
    } finally {
      loading.value = false;
      abortController.value = null;
    }
  }

  function reset() {
    abortController.value?.abort();
    messages.value = [];
    conversationId.value = undefined;
    loading.value = false;
    error.value = null;
    prdResult.value = null;
    abortController.value = null;
  }

  return { messages, conversationId, loading, error, prdResult, send, reset };
});
```text

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores/prdChat.ts
git commit -m "feat(web): PRD 对话 Pinia store"
```text

---

### Task 7: Web 前端 — PrdChat 页面

**Files:**
- Create: `packages/web/src/pages/PrdChat.vue`

- [ ] **Step 1: 创建对话页面**

创建 `packages/web/src/pages/PrdChat.vue`：

```vue
<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { usePrdChatStore } from "../stores/prdChat";

const store = usePrdChatStore();
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
watch(
  () => store.messages.at(-1)?.content,
  scrollToBottom,
);

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
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-3rem)] max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between pb-4 border-b border-gray-200">
      <div>
        <h1 class="text-xl font-semibold text-gray-900 m-0">PRD 智能生成</h1>
        <p class="text-sm text-gray-500 mt-1 m-0">描述你的需求，AI 帮你生成标准 PRD 文档</p>
      </div>
      <button
        @click="handleNewChat"
        class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
      >
        新建对话
      </button>
    </div>

    <!-- Chat Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto py-4 space-y-4">
      <!-- Welcome message when empty -->
      <div
        v-if="store.messages.length === 0"
        class="flex items-start gap-3"
      >
        <div class="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium shrink-0">
          AI
        </div>
        <div class="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 max-w-[80%]">
          <p class="m-0 text-gray-700">你好！请描述一下你想做的功能或需求，简单几句话就行。</p>
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
          {{ msg.role === "user" ? "PM" : "AI" }}
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
          <p class="m-0 whitespace-pre-wrap">{{ msg.content }}</p>
          <p v-if="msg.role === 'assistant' && store.loading && msg === store.messages.at(-1) && !msg.content" class="m-0 text-gray-400">
            思考中...
          </p>
        </div>
      </div>

      <!-- PRD Complete Card -->
      <div v-if="store.prdResult" class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-sm shrink-0">
          ✓
        </div>
        <div class="bg-green-50 border border-green-200 rounded-lg px-4 py-3 max-w-[80%]">
          <p class="m-0 font-medium text-green-800">PRD 已生成：{{ store.prdResult.title }}</p>
          <p class="m-0 mt-1 text-sm text-green-700">文件路径：{{ store.prdResult.prdPath }}</p>
          <a
            :href="store.prdResult.wikiUrl"
            target="_blank"
            class="inline-block mt-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 no-underline transition-colors"
          >
            在 Wiki.js 中查看
          </a>
        </div>
      </div>

      <!-- Error -->
      <div v-if="store.error" class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white text-sm shrink-0">
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
          @keydown="handleKeydown"
          :disabled="store.loading"
          placeholder="描述你的需求..."
          rows="2"
          class="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
        />
        <button
          @click="handleSend"
          :disabled="store.loading || !input.trim()"
          class="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
        >
          {{ store.loading ? "生成中..." : "发送" }}
        </button>
      </div>
    </div>
  </div>
</template>
```text

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/PrdChat.vue
git commit -m "feat(web): PRD 对话页面"
```text

---

### Task 8: Web 前端 — 路由 + 导航入口

**Files:**
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/components/AppLayout.vue`

- [ ] **Step 1: 新增路由**

在 `router/index.ts` 的 routes 数组中，`/trigger` 路由之前新增：

```typescript
    {
      path: "/prd/chat",
      name: "prd-chat",
      component: () => import("../pages/PrdChat.vue"),
    },
```text

- [ ] **Step 2: 在 AppLayout.vue 导航栏新增入口**

在 `AppLayout.vue` 的 `<ul>` 中，第一个 `<li>`（系统概览）之后新增：

```html
        <li>
          <router-link
            to="/prd/chat"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            PRD 生成
          </router-link>
        </li>
```text

- [ ] **Step 3: 运行前端 dev server 手动验证**

Run: `cd packages/web && npx vite dev --open`

验证：
- 左侧导航栏出现"PRD 生成"入口
- 点击后跳转到 `/prd/chat` 页面
- 页面展示对话界面，有欢迎消息、输入框、发送按钮

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/index.ts packages/web/src/components/AppLayout.vue
git commit -m "feat(web): PRD 生成路由 + 导航入口"
```text

---

### Task 9: Dify — PRD 生成 Chatflow DSL

**Files:**
- Create: `setup/dify/prd-gen-chatflow.yml`

- [ ] **Step 1: 创建 Chatflow DSL 文件**

创建 `setup/dify/prd-gen-chatflow.yml`。这是 Dify Chatflow 的 DSL 配置，需要在 Dify 管理界面中导入。

```yaml
app:
  description: '产品需求文档(PRD)智能生成。通过 brainstorming 式多轮对话引导产品经理收集需求信息，信息充分后生成符合模板规范的 PRD 文档。'
  icon: "\U0001F4CB"
  icon_background: '#E4FBCC'
  mode: advanced-chat
  name: 'ArcFlow PRD 生成'
  use_icon_as_answer_icon: false
kind: app
version: 0.1.5
workflow:
  conversation_variables: []
  environment_variables: []
  features:
    file_upload:
      allowed_file_extensions: []
      allowed_file_types: []
      allowed_file_upload_methods:
        - local_file
      enabled: false
      fileUploadSpecificConfig: null
      image:
        enabled: false
      max_length: 0
      number_limits: 0
    opening_statement: '你好！我是 ArcFlow PRD 助手。请描述一下你想做的功能或需求，简单几句话就行。'
    retriever_resource:
      enabled: false
    sensitive_word_avoidance:
      enabled: false
    speech_to_text:
      enabled: false
    suggested_questions: []
    suggested_questions_after_answer:
      enabled: false
    text_to_speech:
      enabled: false
      language: ''
      voice: ''
  graph:
    edges:
      - data:
          sourceType: start
          targetType: llm
        id: start-to-llm
        source: start
        target: llm-main
        type: custom
      - data:
          sourceType: llm
          targetType: answer
        id: llm-to-answer
        source: llm-main
        target: answer-main
        type: custom
    nodes:
      - data:
          desc: ''
          title: 开始
          type: start
          variables: []
        id: start
        position:
          x: 50
          y: 300
        type: custom
      - data:
          context:
            enabled: false
            variable_selector: []
          desc: 'PRD 生成主节点 - brainstorming 式对话引导'
          model:
            completion_params:
              temperature: 0.6
              top_p: 0.9
            mode: chat
            name: claude-opus-4-6
            provider: anthropic
          prompt_template:
            - id: system-prompt
              role: system
              text: |
                你是 ArcFlow 平台的 PRD 助手，帮助产品经理通过对话生成标准的产品需求文档(PRD)。

                ## 你的工作模式

                你使用 brainstorming 方法论引导产品经理：
                1. 每次只问一个问题
                2. 优先给 2-4 个选项（选择题），降低认知负担
                3. 判断信息是否充分，不够就继续追问，够了就生成

                ## 对话流程

                ### 阶段 1 — 快速理解（1-3 轮）
                - 先让 PM 自由描述需求
                - 评估信息密度：如果描述已经很详细，跳过大部分追问

                ### 阶段 2 — 定向补全（0-5 轮，按需）
                只追问缺失的关键信息，追问优先级：
                1. 功能名称（如果描述中不明确）
                2. 核心业务规则（必须有至少 1 条）
                3. 涉及哪些端（后端 / Vue3 Web / Flutter 移动端 / Android 客户端）
                4. 用户角色与权限（可选，如果功能涉及权限控制）

                以下内容你来自行补充，不需要问 PM：
                - 异常处理场景
                - 验收标准（Given/When/Then 格式）
                - 非功能需求
                - frontmatter 字段

                ### 阶段 3 — 摘要确认（1 轮）
                信息充分后，输出要点摘要让 PM 确认：
                - 功能名称
                - 一句话描述
                - 核心业务规则列表
                - 涉及端
                - PRD 类型

                格式示例：
                "我整理一下：
                - **功能名**：手机验证码登录
                - **一句话**：让用户通过手机验证码快速登录，未注册自动创建账号
                - **核心规则**：验证码6位数字、5分钟有效期、支持自动注册
                - **涉及端**：后端 + Vue3 Web
                - **类型**：feature（单功能）

                确认生成 PRD 吗？"

                PM 说"可以/好/确认/没问题"→ 进入生成
                PM 说"不对/改一下"→ 继续补充

                ### 阶段 4 — 生成 PRD
                PM 确认后，基于收集的信息生成完整 PRD。

                **PRD 类型判断规则：**
                - feature：单一功能（如"手机验证码登录"、"密码重置"）
                - module：包含多个子功能点的模块（如"用户管理模块"、"支付系统"）

                **feature 模板结构（严格遵循）：**
                ```
                ---
                title: {功能名}
                type: feature
                status: draft
                owner: {PM名字，从对话中提取，提取不到留空}
                created: {今天日期 YYYY-MM-DD}
                sprint:
                related_prd: []
                ---

                ## 一句话描述
                让[谁]能够[做什么]以达到[什么目的]。

                ## 背景
                （2-3 句话描述为什么要做）

                ## 核心业务规则
                1. 规则一
                2. 规则二

                ## 功能说明
                - 入口在哪
                - 主流程步骤
                - 异常情况处理

                ## 用户角色与权限
                | 角色 | 可执行操作 |
                |------|-----------|

                ## 设计稿
                - Figma 链接：待设计师填写
                - 状态：未开始

                ## 涉及端
                - [ ] 或 [x] 后端
                - [ ] 或 [x] Vue3 Web
                - [ ] 或 [x] Flutter 移动端
                - [ ] 或 [x] Android 客户端

                ## 验收标准
                1. Given 前置条件，When 操作，Then 预期结果

                ## 补充说明（可选）
                ```

                **module 模板结构（严格遵循）：**
                ```
                ---
                title: {模块名}
                type: module
                status: draft
                owner:
                created: {今天日期 YYYY-MM-DD}
                sprint:
                related_prd: []
                ---

                ## 一句话描述

                ## 背景
                ### 现状问题
                ### 目标

                ## 核心业务规则

                ## 功能清单
                | 功能点 | 优先级 | 说明 |
                |--------|--------|------|

                ## 用户角色与权限
                | 角色 | 可执行操作 |
                |------|-----------|

                ## 各功能点说明
                ### 功能 A
                ### 功能 B

                ## 设计稿
                ## 涉及端
                ## 验收标准
                ## 非功能需求（可选）
                ## 补充说明（可选）
                ```

                **输出规则：**
                生成完成后，先输出一句"PRD 已生成！"，然后在特殊标记中输出结构化 JSON：

                <<<PRD_OUTPUT>>>
                {"action":"prd_generated","prd_type":"feature或module","filename":"kebab-case文件名","title":"中文标题","content":"完整的PRD Markdown内容"}
                <<<END_PRD_OUTPUT>>>

                重要：
                - filename 使用 kebab-case 英文（如 sms-login、user-management）
                - content 中的换行用实际换行符，不要用 \n
                - 不要在 JSON 之外重复输出 PRD 内容
                - <<<PRD_OUTPUT>>> 标记必须单独一行
          title: PRD 对话引导
          type: llm
          vision:
            configs:
              detail: high
            enabled: false
        id: llm-main
        position:
          x: 350
          y: 300
        type: custom
      - data:
          answer: '{{#llm-main.text#}}'
          desc: ''
          title: 回复
          type: answer
          variables: []
        id: answer-main
        position:
          x: 650
          y: 300
        type: custom
  hash: null
```text

- [ ] **Step 2: Commit**

```bash
git add setup/dify/prd-gen-chatflow.yml
git commit -m "feat(dify): PRD 生成 Chatflow DSL"
```text

---

### Task 10: 集成验证 + docker-compose 更新

**Files:**
- Modify: `setup/docker-compose.yml`

- [ ] **Step 1: 在 docker-compose.yml gateway 环境变量中新增**

在 `setup/docker-compose.yml` 的 gateway service 的 environment 中，`DIFY_BUG_ANALYSIS_API_KEY` 行之后新增：

```yaml
      DIFY_PRD_GEN_API_KEY: ${DIFY_PRD_GEN_API_KEY:-}
```text

- [ ] **Step 2: 运行 Gateway 全量测试**

Run: `cd packages/gateway && bun test`
Expected: All tests pass（180 tests，0 fail）

- [ ] **Step 3: 构建 Web 前端确认无编译错误**

Run: `cd packages/web && npx vite build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 4: Commit**

```bash
git add setup/docker-compose.yml
git commit -m "chore: docker-compose 新增 DIFY_PRD_GEN_API_KEY 环境变量"
```text
