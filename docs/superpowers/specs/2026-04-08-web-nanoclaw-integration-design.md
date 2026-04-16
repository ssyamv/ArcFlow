> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Web 前端接入 NanoClaw — 设计规格文档

> 版本：v1.0 · 2026-04-08

---

## 一、背景与目标

### 1.1 现状

- NanoClaw（Claude Agent SDK）已完成飞书渠道接入，具备 Plane MCP、arcflow-api skill 等工具能力
- Web 前端（Vue 3）已有 PrdChat 页面，通过 Gateway 直连 Dify Chatflow 生成 PRD
- 用户与系统的 AI 交互分散在飞书（NanoClaw）和 Web（PrdChat）两个入口

### 1.2 目标

将 Web 前端作为 NanoClaw 的 Web 渠道，替代飞书成为用户与系统的主要交互入口。用户在 Web 前端直接与 NanoClaw Agent 对话，统一完成：

- 知识库问答（RAG）
- PRD 生成
- 工作流触发与状态查询
- 任务管理（通过 Plane MCP）
- 文档操作

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 复用 Channel 接口 | WebChannel 实现现有 Channel 接口，不改动 NanoClaw 核心 |
| 整体返回 | Agent 回复完成后一次性推送，不做流式逐字输出 |
| 前端最小改动 | 复用 PrdChat 的 SSE 处理模式，替换数据源即可 |
| Gateway 职责不变 | Gateway 仍为工具后端，不承担 AI Agent 角色 |

---

## 二、架构设计

### 2.1 架构总览

```text
Web 前端 (Vue 3)
  ├── POST /api/chat     → NanoClaw HTTP Server（发送消息）
  └── GET  /api/chat/sse → NanoClaw HTTP Server（SSE 接收回复）

NanoClaw (Claude Agent SDK)
  ├── WebChannel（新增）
  ├── FeishuChannel（保留，降为备用渠道）
  ├── Plane MCP（任务管理）
  ├── arcflow-api skill（RAG、工作流触发、Wiki 操作）
  └── groups/arcflow-main/CLAUDE.md（意图路由 + 上下文）

Gateway（保持不变）
  ├── /api/workflow/*（工作流触发/查询）
  ├── /api/rag/query（知识库查询 — 新增）
  └── Webhook 接收 + 飞书通知推送
```text

### 2.2 组件职责

| 组件 | 职责 | 不做什么 |
|------|------|----------|
| Web 前端 | 聊天 UI、消息展示、用户输入 | 不做意图识别、不直连 Dify |
| NanoClaw | AI Agent、意图路由、工具调用 | 不存储业务数据 |
| Gateway | 工具后端（RAG 查询、工作流、Git、飞书通知） | 不做 AI 对话 |

---

## 三、NanoClaw WebChannel

### 3.1 Channel 接口实现

WebChannel 实现 NanoClaw 的 `Channel` 接口（`src/types.ts`）：

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}
```text

### 3.2 HTTP 端点

WebChannel 在 `connect()` 时启动 Express HTTP Server，提供两个端点：

#### POST `/api/chat` — 接收用户消息

Request:
```json
{
  "client_id": "user-abc",
  "message": "用户登录的接口定义在哪？"
}
```text

Response（立即返回，表示消息已接收）:
```json
{
  "ok": true,
  "message_id": "msg-1712567890123"
}
```text

消息通过 `onMessage` 回调投递给 NanoClaw Container。

#### GET `/api/chat/sse?client_id=user-abc` — SSE 长连接

客户端建立 SSE 连接后，服务端推送 Agent 回复：

```text
event: message
data: {"message_id":"msg-123","content":"根据文档，用户登录接口定义在...","done":true}

event: typing
data: {"is_typing":true}

event: error
data: {"message":"工具调用失败: ..."}
```text

### 3.3 JID 格式

`web:<client_id>`

- `ownsJid(jid)`: 返回 `jid.startsWith("web:")`
- `sendMessage(jid, text)`: 从 jid 提取 client_id，通过 SSE 连接推送

### 3.4 内部状态

```typescript
class WebChannel implements Channel {
  name = "web";
  private server: http.Server | null = null;
  private sseClients = new Map<string, Response>(); // client_id → SSE Response
  private connected = false;
}
```text

### 3.5 环境变量

```env
WEB_CHANNEL_PORT=3001       # WebChannel HTTP 服务端口（默认 3001）
WEB_CHANNEL_CORS_ORIGIN=*   # CORS 允许的源（生产环境应限制）
```text

### 3.6 Channel 注册

在 `src/channels/web.ts` 底部注册：

```typescript
registerChannel("web", (opts: ChannelOpts) => {
  const port = Number(process.env.WEB_CHANNEL_PORT);
  if (!port) return null; // 未配置则跳过
  return new WebChannel(opts, port);
});
```text

---

## 四、Gateway RAG 端点

### 4.1 新增端点

**POST `/api/rag/query`** — blocking 模式知识库查询

Request:
```json
{
  "question": "用户登录接口在哪？",
  "conversation_id": "conv-abc"
}
```text

Response:
```json
{
  "answer": "根据文档 api/user-auth.yaml，用户登录接口定义在...",
  "conversation_id": "conv-abc"
}
```text

### 4.2 实现

在 `services/dify.ts` 新增 `queryKnowledgeBase()` 函数，调用 Dify `/v1/chat-messages` 端点（blocking 模式），使用 `DIFY_RAG_API_KEY`。

在 `routes/api.ts` 新增路由，调用该函数。

### 4.3 配置

Config 接口新增 `difyRagApiKey: string`（已完成）。

`.env` 新增：
```env
DIFY_RAG_API_KEY=app-xxxxxxxx
```text

---

## 五、Web 前端改造

### 5.1 页面替换

| 原文件 | 新文件 | 说明 |
|--------|--------|------|
| `pages/PrdChat.vue` | `pages/Chat.vue` | 统一聊天页面，去掉 PRD 专属逻辑 |
| `api/prd.ts` | `api/chat.ts` | 对接 NanoClaw HTTP+SSE |
| `stores/prdChat.ts` | `stores/chat.ts` | 通用聊天状态管理 |

### 5.2 路由

```typescript
{ path: "/chat", component: Chat }
{ path: "/prd/chat", redirect: "/chat" }  // 兼容旧路由
```text

侧边栏导航将"PRD 生成"改为"AI 助手"。

### 5.3 API 层

`api/chat.ts` 实现：

```typescript
// 建立 SSE 连接，接收 Agent 回复
export function connectSSE(clientId: string, handlers: ChatSSEHandler): EventSource

// 发送消息
export async function sendMessage(clientId: string, message: string): Promise<{ ok: boolean; message_id: string }>
```text

`VITE_NANOCLAW_BASE` 环境变量指定 NanoClaw WebChannel 地址。

### 5.4 Store

`stores/chat.ts`：

```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// State
messages: ChatMessage[]
loading: boolean
error: string | null
clientId: string  // 页面加载时生成，标识当前用户

// Actions
send(message: string): void
reset(): void
```text

### 5.5 Chat.vue 组件

复用 PrdChat.vue 的 UI 结构（消息列表 + 输入框 + markdown 渲染），改动：

- 去掉 PRD 结果卡片（Agent 回复中自然包含链接）
- 去掉 PRD marker 解析逻辑
- SSE 事件从 Gateway 改为 NanoClaw
- 页面标题改为"AI 助手"

---

## 六、数据流

### 6.1 知识问答

```text
用户输入 "用户登录接口在哪？"
  → POST NanoClaw /api/chat { client_id, message }
  → NanoClaw Container 收到消息
  → Claude Agent 识别为知识问答
  → 调用 arcflow-api: rag query "用户登录接口在哪？"
  → arcflow-api POST Gateway /api/rag/query
  → Gateway 调 Dify RAG 工作流（/v1/chat-messages, blocking）
  → Dify 返回答案
  → arcflow-api 返回给 Agent
  → Agent 组织回复
  → sendMessage("web:user-abc", answer)
  → WebChannel 通过 SSE 推送
  → Web 前端显示回复
```text

### 6.2 PRD 生成

```text
用户输入 "帮我写一个用户注册的 PRD"
  → POST NanoClaw /api/chat
  → Claude Agent 识别为 PRD 生成
  → Agent 基于 CLAUDE.md 中的 PRD 模板和上下文直接生成
  → 或调用 arcflow-api: workflow trigger prd_gen
  → sendMessage → SSE → Web 前端
```text

### 6.3 任务管理

```text
用户输入 "创建一个用户注册的 Issue"
  → POST NanoClaw /api/chat
  → Claude Agent 识别为任务管理
  → 调用 Plane MCP create_work_item
  → sendMessage → SSE → Web 前端
```text

---

## 七、部署配置

### 7.1 NanoClaw .env 新增

```env
# Web Channel
WEB_CHANNEL_PORT=3001
WEB_CHANNEL_CORS_ORIGIN=http://localhost:5173  # 开发环境；生产环境改为实际域名
```text

### 7.2 Web 前端 .env 新增

```env
VITE_NANOCLAW_BASE=http://localhost:3001  # NanoClaw WebChannel 地址
```text

### 7.3 容器环境变量传递

`container-runner.ts` 的 `readEnvFile()` 无需改动 — WebChannel 运行在 NanoClaw 主进程，不在 Container 内。

---

## 八、不在本次范围

| 内容 | 原因 |
|------|------|
| 流式逐字输出 | 决策为整体返回，后续可优化 |
| 用户认证 | 当前为内部工具，后续再加 |
| 多会话管理 | 先做单会话，后续扩展 |
| 飞书 Channel 移除 | 保留为备用渠道 |
| 微信 Channel | 独立需求，不在本次 |
