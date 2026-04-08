# PRD 智能生成设计规格

## 概述

为产品经理提供对话式 PRD 生成能力。PM 在 ArcFlow Web 管理界面中通过对话描述需求，AI 基于 brainstorming 方法论引导收集信息，信息充分后自动生成符合模板规范的 PRD 文档，写入 docs Git 仓库并同步到 Wiki.js。

## 架构

```text
┌─────────────┐     SSE 流式      ┌──────────────┐    Chatflow API    ┌───────────────┐
│  Web 前端    │ ←──────────────→ │   Gateway     │ ←───────────────→ │  Dify Chatflow │
│  对话页面    │                   │  消息透传     │                    │  对话引导+生成  │
└─────────────┘                   │  + 写入分发   │                    │  (Opus)        │
                                  └──────┬───────┘                    └───────────────┘
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                          docs Git   Wiki.js     飞书通知
                                     (5min同步)   (可选)
```text

### 各层职责

| 层 | 职责 | 不做 |
|----|------|------|
| Web 前端 | 对话 UI、消息展示、流式渲染、PRD 预览 | 不做对话逻辑判断 |
| Gateway | 消息透传 Dify、会话管理、识别生成完成信号、写入 Git/Wiki.js/通知 | 不做 AI 推理 |
| Dify Chatflow | 多轮对话引导、信息充分度判断、PRD 生成、输出结构化结果 | 不做文件写入 |

## Dify Chatflow 设计

### 模型选择

claude-opus-4-6 — 与技术文档生成保持同级，确保 PRD 质量。

### 对话引导策略（brainstorming 方法论）

Chatflow 的 System Prompt 编码以下规则：

#### 阶段 1 — 快速理解（1-3 轮）

- 首轮开场："你好！请描述一下你想做的功能或需求，简单几句话就行。"
- PM 回答后，AI 评估信息密度

#### 阶段 2 — 定向补全（0-5 轮，按需）

AI 检查已收集信息 vs PRD 模板必填项，只追问缺失的关键信息：

- 一次只问一个问题
- 优先给 2-4 个选项（选择题），降低 PM 认知负担
- 追问优先级：功能名 > 核心业务规则 > 涉及端 > 用户角色
- 不追问可由 AI 合理推断的内容（异常处理、验收标准、非功能需求）

判断信息充分的标准：
- 能写出明确的"一句话描述"（让[谁]能够[做什么]以达到[什么目的]）
- 至少 1 条明确的业务规则
- 知道涉及哪些端

#### 阶段 3 — 摘要确认（1 轮）

信息充分后，输出要点摘要：
- 功能名称
- 一句话描述
- 核心业务规则（列表）
- 涉及端
- PRD 类型（feature/module，AI 自动判断）

等待 PM 确认。PM 说"可以/好/确认"→ 进入生成；PM 说"不对/改一下"→ 回到阶段 2。

#### 阶段 4 — 生成 PRD**

PM 确认后，AI 基于收集的信息 + 模板生成完整 PRD，输出格式：

```json
{
  "action": "prd_generated",
  "prd_type": "feature",
  "filename": "sms-login",
  "title": "手机验证码登录",
  "content": "---\ntitle: 手机验证码登录\ntype: feature\n..."
}
```text

### AI 自动补全的内容

以下内容不需要问 PM，AI 根据上下文合理生成：

- PRD 类型判断（feature vs module）：单一功能用 feature，包含多个子功能点用 module
- 异常处理场景：根据功能推理常见异常
- 验收标准：按 Given/When/Then 格式生成
- frontmatter 字段：status=draft，created=当天日期，owner 从对话上下文提取或留空
- 设计稿状态：默认"未开始"

### PRD 模板

Chatflow 中内置两套模板作为参考（与 docs 仓库中 `prd/_template-feature.md` 和 `prd/_template-module.md` 保持一致），生成时严格遵循模板结构。

## Gateway 设计

### 新增 API

**对话消息接口（SSE 流式）：**

```text
POST /api/prd/chat
Content-Type: application/json

{
  "message": "我想做一个手机验证码登录功能",
  "conversation_id": "conv_xxx"    // 首次为空，后续传回
}

Response: SSE 流式返回
event: message
data: {"type": "text", "content": "好的，...", "conversation_id": "conv_xxx"}

event: message
data: {"type": "text", "content": "涉及哪些端？A. ..."}

// 最后一轮（生成完成时）
event: prd_complete
data: {"prd_path": "prd/2026-04/sms-login.md", "wiki_url": "http://172.29.230.21:3000/prd/2026-04/sms-login", "title": "手机验证码登录"}

注：conversation_id 在首条 message 事件中返回，前端缓存后在后续请求中传回。
```text

**会话列表接口（可选，后续）：**

```text
GET /api/prd/conversations
```text

### SSE 流式实现方案

Gateway 使用 Hono 的 `streamSSE` helper 实现 Server-Sent Events 响应：

```typescript
import { streamSSE } from "hono/streaming";

app.post("/api/prd/chat", (c) => {
  return streamSSE(c, async (stream) => {
    const { message, conversation_id } = await c.req.json();

    // 1. 调 Dify Chatflow API（streaming 模式）
    // Dify API: POST {difyBaseUrl}/v1/chat-messages
    const response = await fetch(`${config.difyBaseUrl}/v1/chat-messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.difyPrdGenApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: message,
        conversation_id: conversation_id || "",
        response_mode: "streaming",
        user: "pm",
        inputs: {},
      }),
    });

    // 2. 逐 chunk 解析 Dify SSE 并转发给前端
    // Dify streaming chunk 类型：
    //   - message: { event: "message", answer: "文本片段", conversation_id: "xxx" }
    //   - message_end: { event: "message_end", metadata: {...} }
    let fullAnswer = "";
    let convId = conversation_id;
    let prdMarkerDetected = false;

    for await (const chunk of parseDifySSE(response.body)) {
      if (chunk.event === "message") {
        convId = convId || chunk.conversation_id;
        fullAnswer += chunk.answer;

        // 检测到 PRD 输出标记后，停止向前端转发（避免前端显示标记文本）
        if (fullAnswer.includes("<<<PRD_OUTPUT>>>")) {
          if (!prdMarkerDetected) {
            // 只转发标记之前的文本
            const beforeMarker = chunk.answer.split("<<<PRD_OUTPUT>>>")[0];
            if (beforeMarker) {
              await stream.writeSSE({ event: "message", data: JSON.stringify({
                type: "text", content: beforeMarker, conversation_id: convId
              })});
            }
            prdMarkerDetected = true;
          }
          continue; // 不转发标记内的内容
        }

        // 正常文本 chunk，透传给前端（首条消息附带 conversation_id）
        await stream.writeSSE({ event: "message", data: JSON.stringify({
          type: "text", content: chunk.answer, conversation_id: convId
        })});
      }

      if (chunk.event === "message_end") {
        // 检查完整响应是否包含 PRD 生成结果
        const prdMatch = fullAnswer.match(/<<<PRD_OUTPUT>>>([\s\S]*?)<<<END_PRD_OUTPUT>>>/);
        if (prdMatch) {
          const result = JSON.parse(prdMatch[1].trim());

          // 写入 docs Git
          const now = new Date();
          const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const path = `prd/${yearMonth}/${result.filename}.md`;
          await ensureRepo("docs");
          await writeAndPush("docs", path, result.content,
            `feat(prd): 新增 ${result.title} PRD`);

          // 触发 Wiki.js 同步（非阻塞）
          triggerSync().catch(() => {});

          // Wiki.js URL = wikijsBaseUrl + "/" + path（去掉 .md）
          const wikiUrl = `${config.wikijsBaseUrl}/${path.replace(/\.md$/, "")}`;

          // 发送完成事件
          await stream.writeSSE({ event: "prd_complete", data: JSON.stringify({
            prd_path: path, wiki_url: wikiUrl, title: result.title
          })});
        }
      }
    }
  });
});
```text

### Dify Chatflow SSE 数据结构

Dify streaming API 返回的 SSE chunk 格式：

```text
// 文本片段（可能有多个）
event: message
data: {"event":"message","message_id":"xxx","conversation_id":"conv_xxx","answer":"文本片段","created_at":1234567890}

// 对话结束
event: message_end
data: {"event":"message_end","message_id":"xxx","conversation_id":"conv_xxx","metadata":{"usage":{...}}}
```text

`conversation_id` 在每个 `message` chunk 中都会返回。Gateway 从首个 chunk 中提取并通过 SSE `message` 事件传给前端，前端缓存后用于后续请求。

### 完成信号识别

Dify Chatflow 最终轮（PM 确认生成后）输出中包含 JSON 标记：

```json
{"action": "prd_generated", "prd_type": "...", "filename": "...", "title": "...", "content": "..."}
```text

为避免误识别，JSON 用特定分隔符包裹：

```text
<<<PRD_OUTPUT>>>
{"action": "prd_generated", ...}
<<<END_PRD_OUTPUT>>>
```text

**流式过滤规则：** Gateway 在流式转发过程中，一旦检测到 `<<<PRD_OUTPUT>>>` 标记，立即停止向前端转发后续文本。标记之前的内容（如"PRD 已生成！"）正常展示，标记内的 JSON 数据仅由 Gateway 提取处理，不会出现在前端。

**Wiki.js URL 构造规则：** `wikijsBaseUrl` + `/` + 文件路径去掉 `.md` 后缀。例如 `prd/2026-04/sms-login.md` → `http://172.29.230.21:3000/prd/2026-04/sms-login`。

### 新增环境变量

```text
DIFY_PRD_GEN_API_KEY=    # Dify PRD 生成 Chatflow 的 API Key
```text

### 新增配置

在 `config.ts` 中新增：

```typescript
difyPrdGenApiKey: process.env.DIFY_PRD_GEN_API_KEY ?? process.env.DIFY_API_KEY ?? "",
```text

## Web 前端设计

### 页面结构

新增页面 `PrdChat.vue`，路由 `/prd/chat`。

**布局：**

```text
┌──────────────────────────────────────┐
│  ArcFlow         [PRD生成] [工作流]  │  ← 导航栏新增入口
├──────────────────────────────────────┤
│                                      │
│  ┌─ AI ──────────────────────────┐   │
│  │ 你好！请描述一下你想做的功能   │   │
│  └───────────────────────────────┘   │
│                                      │
│  ┌───────────────────────── PM ─┐   │
│  │ 我想做一个手机验证码登录...   │   │
│  └───────────────────────────────┘   │
│                                      │
│  ┌─ AI ──────────────────────────┐   │
│  │ 涉及哪些端？                   │   │
│  │ A. 后端+Web                    │   │
│  │ B. 后端+Web+移动端             │   │
│  │ C. 全端                        │   │
│  └───────────────────────────────┘   │
│                                      │
│  ┌─ 生成完成 ────────────────────┐   │
│  │ ✅ PRD 已生成                  │   │
│  │ [在 Wiki.js 中查看]            │   │
│  └───────────────────────────────┘   │
│                                      │
│  ┌──────────────────────── [发送]┐   │
│  │ 输入需求描述...                │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```text

### 核心交互

- 标准对话 UI：消息气泡（AI 左，PM 右）
- SSE 流式渲染：AI 回复逐字显示
- 选项点击：当 AI 给出选择题时，选项可点击直接发送（也可以手动输入）
- 生成完成：展示成功卡片，包含 Wiki.js 链接
- 新对话：左上角或页面底部提供"新建对话"按钮

### 技术实现

- 使用 `EventSource` 或 `fetch` + `ReadableStream` 处理 SSE
- 消息列表存储在 Pinia store 中
- conversation_id 由首次请求返回后保存，后续请求携带
- Markdown 渲染：选项、代码块、表格等需要正确渲染

## 文件变更清单

### Gateway（packages/gateway）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/config.ts` | 修改 | 新增 `difyPrdGenApiKey` |
| `src/services/dify.ts` | 修改 | 新增 `chatWithDify()` 函数（Chatflow streaming 调用，返回 AsyncIterable） |
| `src/routes/api.ts` | 修改 | 新增 `POST /api/prd/chat` SSE 路由 |
| `src/services/prd.ts` | 新增 | PRD 对话处理：Dify SSE 解析、完成信号识别、流式过滤、Git 写入 |
| `src/services/prd.test.ts` | 新增 | PRD 服务测试（SSE 解析、信号提取、路径生成） |

注：PRD 对话不纳入 `WorkflowType` 和 `workflow_execution` 体系。它是多轮交互而非单次触发的工作流，由 Dify Chatflow 自带的 conversation 管理对话状态。

### Web 前端（packages/web）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pages/PrdChat.vue` | 新增 | 对话页面 |
| `src/api/prd.ts` | 新增 | PRD 对话 API 调用（SSE） |
| `src/stores/prdChat.ts` | 新增 | 对话状态管理 |
| `src/router/index.ts` | 修改 | 新增路由 `/prd/chat` |
| `src/components/ChatMessage.vue` | 新增 | 对话消息气泡组件 |
| `src/components/PrdComplete.vue` | 新增 | PRD 生成完成卡片组件 |

### Dify

| 资源 | 操作 | 说明 |
|------|------|------|
| PRD 生成 Chatflow | 新建 | Dify 中创建 Chatflow 应用，配置 Opus 模型 + PRD 模板 + brainstorming Prompt |
| DSL 文件 | 新增 | 导出 DSL 存入 `setup/dify/` 目录 |

## 数据流示例

以"手机验证码登录"为例的完整对话流：

```text
PM: 我想做一个手机验证码登录功能，支持自动注册，验证码5分钟有效
    → Gateway 透传 → Dify Chatflow

AI: 明白。涉及哪些端？
    A. 后端 + Vue3 Web
    B. 后端 + Web + Flutter 移动端
    C. 全端（后端 + Web + Flutter + Android）
    ← Dify → Gateway SSE → Web 前端

PM: A
    → Gateway → Dify

AI: 需要区分用户角色吗？
    A. 不需要，所有用户相同权限
    B. 区分普通用户和管理员
    ← Dify → Gateway → Web

PM: B，管理员可以看登录日志和配置参数
    → Gateway → Dify

AI: [信息充分，输出摘要]
    我整理一下：
    - 功能名：手机验证码登录
    - 一句话：让用户通过手机验证码快速登录，未注册自动创建账号
    - 核心规则：验证码6位数字、5分钟有效期、支持自动注册
    - 涉及端：后端 + Vue3 Web
    - 角色：普通用户（登录）、管理员（查看日志+配置）
    
    确认生成 PRD 吗？
    ← Dify → Gateway → Web

PM: 确认
    → Gateway → Dify

AI: PRD 已生成！
    <<<PRD_OUTPUT>>>
    {"action":"prd_generated","prd_type":"feature","filename":"sms-login","title":"手机验证码登录","content":"---\ntitle: 手机验证码登录\n...完整PRD内容..."}
    <<<END_PRD_OUTPUT>>>
    ← Dify → Gateway 识别信号 → 写入 Git → Wiki.js 同步
    ← Gateway SSE prd_complete 事件 → Web 展示成功卡片
```text

## 不做的事情

- **不做对话历史持久化** — 首版对话仅在页面会话中保持，刷新后重新开始。Dify Chatflow 自带 conversation 管理
- **不做 PRD 在线编辑** — PM 在 Wiki.js 中编辑，Git 双向同步
- **不做自动创建 Plane Issue** — PM Review PRD 后手动创建，保持人工审批门禁
- **不做多人协作对话** — 单用户对话生成
- **不做飞书通知** — 网络不通，后续恢复后再加
