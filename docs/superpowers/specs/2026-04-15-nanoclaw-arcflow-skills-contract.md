> 文档状态：当前阶段参考。此文档与当前 NanoClaw / Gateway 主线直接相关，但项目总览与最终口径仍以 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md` 为准。

# NanoClaw arcflow-* Skills Contract

> 版本：v1.0 · 2026-04-15
> 状态：生产

---

## 一、概述

ArcFlow Gateway 通过 `POST /api/nanoclaw/dispatch` 向 NanoClaw 分派系统任务，NanoClaw
加载对应的 arcflow-* Skill 执行，结果通过 `POST {GATEWAY_URL}/api/workflow/callback` 回调。

### Skill 清单

| Skill | 类型 | 触发场景 |
|-------|------|----------|
| `arcflow-prd-draft` | 交互 | PM 在 Chat 发起 PRD 草稿生成对话 |
| `arcflow-prd-to-tech` | 非交互 | Plane Issue → Approved，生成技术设计文档 + OpenAPI |
| `arcflow-tech-to-openapi` | 非交互 | 独立触发，仅生成 OpenAPI |
| `arcflow-bug-analysis` | 非交互 | CI/CD 测试失败，生成 Bug 报告并尝试自动修复 |
| `arcflow-rag` | 非交互 | 知识库问答 |

**交互 Skill**：通过 WebChannel SSE 流式返回给用户。
**非交互 Skill**：后台执行，通过 callback 回传结果。

---

## 二、dispatch 请求格式

```http
POST /api/nanoclaw/dispatch
X-System-Secret: {NANOCLAW_DISPATCH_SECRET}
Content-Type: application/json
```

```json
{
  "skill": "arcflow-prd-to-tech",
  "workspace_id": 1,
  "plane_issue_id": "ISS-42",
  "user_id": 0,
  "input": { /* skill-specific input */ }
}
```

Gateway 将 dispatch 记录写入 SQLite `dispatch` 表（`status=pending`），然后通过
WebChannel 消息触发 NanoClaw。

---

## 三、Skill 输入/输出规范

### 3.1 arcflow-prd-draft（交互）

#### 输入（通过 WebChannel 用户消息传入，无 dispatch input 字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | string | 用户消息（PM 描述需求） |
| `workspace_id` | string | 工作空间 ID |
| `conversation_id` | number? | 已有对话 ID（续接多轮） |

**输出**（SSE 流，见第五节）

多轮对话，最终输出完整 PRD Markdown。PRD 正文以 `===PRD_RESULT_START===` 开头标记。

**无 callback**：交互 Skill 结果通过 SSE 直接交付用户，不走 `/api/workflow/callback`。

---

### 3.2 arcflow-prd-to-tech（非交互）

#### prd-to-tech dispatch input

```json
{
  "prd_path": "prd/2026-04/user-auth.md",
  "workspace_id": "1",
  "plane_issue_id": "ISS-42"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prd_path` | string | 是 | docs Git 仓库中的 PRD 文件路径 |
| `workspace_id` | string | 是 | 工作空间 ID |
| `plane_issue_id` | string | 否 | 关联的 Plane Issue ID |

**callback body**（成功）

```json
{
  "dispatch_id": "disp_abc123",
  "skill": "arcflow-prd-to-tech",
  "status": "success",
  "output": {
    "tech_doc_path": "tech-design/2026-04/user-auth.md",
    "openapi_path": "api/2026-04/user-auth.yaml",
    "plane_issue_id": "ISS-42"
  }
}
```

**callback body**（失败）

```json
{
  "dispatch_id": "disp_abc123",
  "skill": "arcflow-prd-to-tech",
  "status": "failed",
  "error": "PRD file not found: prd/2026-04/user-auth.md"
}
```

---

### 3.3 arcflow-tech-to-openapi（非交互）

#### tech-to-openapi dispatch input

```json
{
  "tech_doc_path": "tech-design/2026-04/user-auth.md",
  "workspace_id": "1",
  "plane_issue_id": "ISS-42"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tech_doc_path` | string | 是 | docs Git 仓库中的技术设计文档路径 |
| `workspace_id` | string | 是 | 工作空间 ID |
| `plane_issue_id` | string | 否 | 关联的 Plane Issue ID |

**callback body**（成功）

```json
{
  "dispatch_id": "disp_def456",
  "skill": "arcflow-tech-to-openapi",
  "status": "success",
  "output": {
    "openapi_path": "api/2026-04/user-auth.yaml",
    "plane_issue_id": "ISS-42"
  }
}
```

---

### 3.4 arcflow-bug-analysis（非交互）

#### bug-analysis dispatch input

```json
{
  "ci_log": "ERROR: NullPointerException at UserService.java:142\n...",
  "workspace_id": "1",
  "plane_issue_id": "ISS-55",
  "repo": "backend",
  "branch": "feature/ISS-55-user-auth",
  "commit": "a3f8c92"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ci_log` | string | 是 | CI/CD 失败日志原始内容 |
| `workspace_id` | string | 是 | 工作空间 ID |
| `plane_issue_id` | string | 否 | 关联的 Plane Issue ID |
| `repo` | string | 否 | 代码仓库名（默认 `backend`） |
| `branch` | string | 否 | 失败分支 |
| `commit` | string | 否 | 失败 commit hash |

**callback body**（成功，已分析 + 已尝试修复）

```json
{
  "dispatch_id": "disp_ghi789",
  "skill": "arcflow-bug-analysis",
  "status": "success",
  "output": {
    "bug_report": "## Bug 分析报告\n\n### 错误摘要\n...",
    "severity": "P1",
    "plane_issue_id": "ISS-55",
    "fix_attempted": true,
    "fix_branch": "fix/bug-ISS-55",
    "fix_success": true
  }
}
```

**callback body**（已达修复上限，转人工）

```json
{
  "dispatch_id": "disp_ghi789",
  "skill": "arcflow-bug-analysis",
  "status": "success",
  "output": {
    "bug_report": "## Bug 分析报告\n...",
    "severity": "P0",
    "plane_issue_id": "ISS-55",
    "fix_attempted": false,
    "escalated": true,
    "escalate_reason": "auto-fix retry limit reached (2/2)"
  }
}
```

---

### 3.5 arcflow-rag（非交互）

#### rag dispatch input

```json
{
  "question": "如何配置飞书 Webhook Secret？",
  "workspace_id": "1",
  "conversation_id": "conv-xyz"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `question` | string | 是 | 用户自然语言问题 |
| `workspace_id` | string | 是 | 工作空间 ID |
| `conversation_id` | string | 否 | 对话 ID（用于多轮追问上下文） |

**callback body**（成功）

```json
{
  "dispatch_id": "disp_jkl012",
  "skill": "arcflow-rag",
  "status": "success",
  "output": {
    "answer": "配置飞书 Webhook Secret 需要...",
    "sources": [
      { "title": "Gateway 服务设计", "path": "arch/gateway-design.md" }
    ],
    "conversation_id": "conv-xyz"
  }
}
```

---

## 四、Callback 协议

NanoClaw 在 Skill 执行完毕后，向 Gateway 回调：

```http
POST {GATEWAY_URL}/api/workflow/callback
X-System-Secret: {NANOCLAW_DISPATCH_SECRET}
Content-Type: application/json
```

```json
{
  "dispatch_id": "disp_abc123",
  "skill": "arcflow-prd-to-tech",
  "status": "success" | "failed",
  "output": { ... },
  "error": "错误信息（仅 status=failed 时）"
}
```

Gateway 在 `POST /api/workflow/callback` 中：

1. 验证 `X-System-Secret`
2. 根据 `dispatch_id` 查找 `dispatch` 表记录
3. 更新 `dispatch.status`
4. 根据 `skill` 路由到对应的后处理逻辑（写 Git、通知飞书、创建 Plane Issue 等）

---

## 五、交互 Skill SSE 事件序列

交互 Skill（`arcflow-prd-draft`）通过 NanoClaw WebChannel SSE 流式推送以下事件：

```text
event: session_start
data: {"session_id":"sess_abc","client_id":"web-u1-conv42"}

event: thinking_start
data: {}

event: thinking_delta
data: {"text":"分析用户需求中..."}

event: message_delta
data: {"text":"好的，我来帮您起草 PRD。"}

event: tool_call_start
data: {"tool_call_id":"tc_01","name":"Read","input_preview":"prd/template.md"}

event: tool_call_end
data: {"tool_call_id":"tc_01","ok":true,"summary":"读取 PRD 模板成功"}

event: skill_loaded
data: {"name":"arcflow-prd-draft"}

event: message_delta
data: {"text":"根据您的描述，功能概述如下..."}

event: message_end
data: {"stop_reason":"end_turn"}

event: done
data: {}
```

### 事件说明

| 事件 | 含义 |
|------|------|
| `session_start` | WebChannel 连接建立，返回 session_id |
| `thinking_start` | 模型开始思考（extended thinking 开启时） |
| `thinking_delta` | 思考内容增量（不展示给用户） |
| `message_delta` | 助手消息增量，前端 append 到当前消息 |
| `tool_call_start` | Skill 调用工具开始，含工具名和输入预览 |
| `tool_call_progress` | 工具执行过程中的进度文本 |
| `tool_call_end` | 工具调用结束，含成功/失败状态和摘要 |
| `skill_loaded` | Skill 已加载，含 skill 名称 |
| `artifact` | Skill 产出物（如生成的文档）整体推送 |
| `error` | 错误事件，含 `message` 字段 |
| `message_end` | 本轮助手回复结束 |
| `done` | SSE 流结束，前端可关闭连接 |

---

## 六、Prompt 骨架

### 6.1 arcflow-prd-draft

```text
你是 ArcFlow 的 PRD 助手，帮助 PM 将需求描述转化为规范的产品需求文档（PRD）。

工作方式：
- 通过多轮对话澄清需求细节，每轮提出不超过 3 个关键问题
- 当信息足够充分时，生成完整的 PRD 文档
- PRD 正文以 ===PRD_RESULT_START=== 开头，===PRD_RESULT_END=== 结尾

PRD 模板结构：
1. 功能概述（一句话）
2. 背景与目标
3. 用户故事（Who / What / Why）
4. 功能需求（详细列表，含验收标准）
5. 非功能需求（性能、安全、兼容性）
6. 不在范围内（Out of Scope）
7. 依赖与风险

只在信息充分时生成 PRD，否则继续追问。
```

### 6.2 arcflow-prd-to-tech

```text
你是一个资深 Java Spring Boot 后端架构师。根据输入的 PRD 文档生成技术设计文档。

技术栈约束：
- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- 前端：Vue3（Web）、Flutter 3.x + GetX（移动端）、Kotlin（Android 客户端）
- 接口规范：RESTful，统一返回 Result<T>
- 分层：Controller → Service → ServiceImpl → Mapper → Entity

输出必须包含：
1. 功能概述（一句话）
2. 需求理解确认（复述 PRD 中的核心业务规则，列出疑问点）
3. 数据库设计（建表 SQL）
4. 接口设计（接口列表，含请求/响应字段）
5. 分层实现说明
6. 涉及的现有模块改动
7. 注意事项 & 边界情况

只输出 Markdown 文档内容，不输出任何解释性文字。
如 PRD 内容不足以推断某项设计决策，在对应章节以 [待确认] 标注。
文档 frontmatter 中的 source_prd、generated_by、generated_at 字段由系统自动填入。
```

### 6.3 arcflow-tech-to-openapi

```text
你是一个 API 规范工程师。根据输入的技术设计文档，生成符合 OpenAPI 3.0.3 规范的 yaml 文件。

技术栈约束：
- 后端：Java 17 + Spring Boot 3.x
- 接口路径以 /api/v1/ 开头，路径命名小写中划线
- 统一返回 Result<T>，结构为 { code: integer, message: string, data: T }
- 成功 code=200，业务错误码从 1000 起
- 分页响应使用 { records: [], total: integer, size: integer, current: integer }

生成规则：
1. 每个接口必须包含：summary、operationId、parameters/requestBody、responses（200 和错误码）
2. 所有 Schema 定义放在 components/schemas 下，接口通过 $ref 引用
3. 请求体使用 application/json
4. 必须包含 Result 和 PageResult 的通用 Schema 定义
5. operationId 使用 camelCase，与技术设计文档中的接口函数命名一致
6. 每个接口的 responses 至少包含 200（成功）和 400（参数错误）
7. 需要认证的接口添加 security 字段，引用 BearerAuth
8. 必须包含 info（title、version）和 servers（至少一个条目）字段
9. 必须在 components/securitySchemes 下声明 BearerAuth（type: http, scheme: bearer, bearerFormat: JWT）

只输出 yaml 内容，不输出任何解释性文字。
```

### 6.4 arcflow-bug-analysis

```text
你是一个 CI/CD 故障分析专家。根据输入的测试失败日志，生成结构化的 Bug 分析报告。

分析流程：
1. 从日志中提取失败的测试用例名称和错误信息
2. 定位错误根因（编译错误、运行时异常、断言失败、超时等）
3. 关联可能的代码位置（从堆栈信息中提取类名、方法名、行号）
4. 评估严重程度

输出格式（Markdown）：

## Bug 分析报告

### 基本信息
- 关联 Issue：（由系统注入）
- 失败阶段：编译 / 单元测试 / 集成测试

### 错误摘要
一句话描述错误的核心原因。

### 失败详情
| 测试用例 | 错误类型 | 错误信息 |
|----------|----------|----------|

### 根因分析
分析错误的根本原因，引用日志中的关键信息。

### 定位建议
列出最可能需要修改的文件和方法。

### 严重级别
- P0 阻塞：编译失败或核心功能不可用
- P1 严重：主流程功能异常
- P2 一般：边缘情况或非核心功能异常

### 修复建议
给出具体的修复方向（不写代码，只描述思路）。

只输出 Markdown 内容，不输出任何解释性文字。
如日志信息不足以定位根因，在"根因分析"中明确指出缺少什么信息。
严重级别行以 **严重级别:** P0/P1/P2 格式输出（Gateway 解析此行）。
```

### 6.5 arcflow-rag

```text
你是 ArcFlow 项目的知识助手。基于 docs Git 仓库中的文档内容回答团队成员的问题。

工作方式：
- 使用 Read、Grep 工具在 docs 仓库中检索相关文档
- 优先检索 arch/、prd/、tech-design/、api/ 目录

回答规则：
1. 只基于检索到的文档内容回答，不使用外部知识
2. 如果文档无法回答问题，明确告知"未找到相关文档"，不要编造
3. 回答简洁直接，先给结论，再补充细节
4. 在回答末尾附上来源文档的标题和路径

回答格式：

{直接回答问题}

{补充细节（如需要）}

---
来源文档：
- [{文档标题}]({文档路径})

注意事项：
- 如果文档 frontmatter 中 status 为 deprecated，提醒用户该文档已废弃
- 技术问题尽量引用文档中的代码示例或配置片段
```

---

## 七、安全与超时

| 项目 | 规范 |
|------|------|
| 认证 | 所有 dispatch/callback 请求必须携带 `X-System-Secret` 头 |
| 超时 | dispatch 记录在 `timeout_at = created_at + 10min` 时标记为 `timeout` |
| 白名单 | Gateway 只接受 `ALLOWED_SKILLS` 列表内的 skill 名称 |
| 幂等 | 同一 `dispatch_id` 的 callback 只处理一次（status 非 pending 则忽略） |

---

## 八、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-15 | 初版，5 个 arcflow-* Skill 契约 |
