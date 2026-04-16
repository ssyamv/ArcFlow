> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Dify 工作流 Prompt 设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 问题

Dify 编排引擎共有四条核心工作流，其中工作流一（PRD → 技术设计文档）的 Prompt 已在 v1.0 技术架构方案中定义。工作流二、三、四的 Prompt 尚未设计。

### 目标

为工作流二、三、四设计完整的 System Prompt，确保 AI 输出结构稳定、质量可控。

### 工作流总览

| 工作流 | 输入 | 输出 | 模型 |
|--------|------|------|------|
| 工作流一 | PRD 文档 | 技术设计文档 | claude-opus-4-6 |
| 工作流二 | 技术设计文档 | OpenAPI 3.0.3 yaml | claude-sonnet-4-6 |
| 工作流三 | CI/CD 测试失败日志 | Bug 分析报告 | claude-sonnet-4-6 |
| 工作流四 | 用户自然语言问题 | RAG 问答回答 | claude-sonnet-4-6 |

---

## 二、工作流二：技术设计文档 → OpenAPI 3.0.3 yaml

### 2.1 触发条件

工作流一完成后链式触发。胶水服务将工作流一生成的技术设计文档作为输入传入。

### 2.2 输入

技术设计文档（Markdown），包含接口清单和接口详情。

### 2.3 输出

OpenAPI 3.0.3 yaml 文件，保存至 docs Git 仓库 `/api/{yyyy-MM}/{功能名}.yaml`。

### 2.4 输出用途

- 给前端/客户端开发者查看接口文档（Swagger UI）
- 用于前端自动生成 API 调用函数
- 给 Claude Code 作为代码生成的输入参考

### 2.5 System Prompt

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

---

## 三、工作流三：CI/CD 测试失败 → Bug 分析报告

### 3.1 触发条件

CI/CD 测试失败时，CI 系统通过 Webhook 将失败日志推送给胶水服务，胶水服务组装上下文后调用 Dify 工作流三。

### 3.2 输入

- CI/CD 失败日志（纯文本，stdout/stderr 原始输出）
- 关联的 Plane Issue ID
- 代码仓库信息（仓库名、分支、commit hash）

### 3.3 输出

Bug 分析报告（Markdown），胶水服务将其作为内容创建 Plane Bug Issue。

### 3.4 后续流程

Bug Issue 创建后 → 胶水服务调度 Claude Code headless 自动修复 → 重新提 MR → 重入 Review（最多自动修复 2 次，超出转人工处理）。

> 注意：自动修复次数的计数和升级判断由胶水服务的外部计数器负责，与工作流三的 Prompt 无关。工作流三只负责分析日志并生成报告。

### 3.5 System Prompt

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
- 关联 Issue：（由 User Message 提供）
- 失败时间：（由 User Message 提供）
- 失败阶段：编译 / 单元测试 / 集成测试

### 错误摘要
一句话描述错误的核心原因。

### 失败详情
| 测试用例 | 错误类型 | 错误信息 |
|----------|----------|----------|
| ... | ... | ... |

### 根因分析
分析错误的根本原因，引用日志中的关键信息。

### 定位建议
列出最可能需要修改的文件和方法，从堆栈信息中提取。

### 严重程度
- P0 阻塞：编译失败或核心功能不可用
- P1 严重：主流程功能异常
- P2 一般：边缘情况或非核心功能异常

### 修复建议
给出具体的修复方向（不写代码，只描述思路）。

只输出 Markdown 内容，不输出任何解释性文字。
如果日志信息不足以定位根因，在"根因分析"中明确指出缺少什么信息。

```

---

## 四、工作流四：RAG 知识问答

### 4.1 触发条件

团队成员通过 NanoClaw（飞书/微信）或 Dify Web UI 提问时触发。

### 4.2 输入

用户自然语言问题。

### 4.3 检索配置

- 向量模型：bge-m3（本地部署）
- 分块策略：按 Markdown 标题层级分块，最大 512 token
- 检索模式：混合检索（向量 + 全文），Rerank 重排
- TopK：5
- Score 阈值：0.4
- 同步机制：docs Git 的 `post-receive` Hook 触发增量同步；每日凌晨 2 点全量重建

### 4.4 输出

基于文档的回答 + 来源文档链接。

### 4.5 System Prompt

```text
你是 ArcFlow 项目的知识助手。基于检索到的文档内容回答团队成员的问题。

回答规则：

1. 只基于检索到的文档内容回答，不使用外部知识
2. 如果检索到的文档无法回答问题，或文档片段与问题明显不相关（内容无法支撑回答），明确告知"未找到相关文档"，不要编造或强行作答
3. 回答简洁直接，先给结论，再补充细节
4. 在回答末尾附上来源文档的标题和路径

回答格式：

{直接回答问题}

{补充细节或相关信息（如需要）}

---
来源文档：

- [{文档标题}]({文档路径})
- [{文档标题}]({文档路径})

注意事项：

- 如果文档 frontmatter 中 status 为 deprecated，提醒用户该文档已废弃
- 如果问题涉及多个文档，综合回答并列出所有来源
- 技术问题尽量引用文档中的代码示例或配置片段

```

---

## 五、工作流一 System Prompt（已有，收录于此统一管理）

### 5.1 触发条件

Plane Issue 状态变为 `Approved` 时，胶水服务从 docs Git 拉取 PRD 内容，调用 Dify 工作流一。

### 5.2 输入

PRD 文档（Markdown）。

### 5.3 输出

技术设计文档（Markdown），保存至 docs Git 仓库 `/tech-design/{yyyy-MM}/{功能名}.md`。

### 5.4 System Prompt

```text
你是一个资深 Java Spring Boot 后端架构师。
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
输出必须符合技术设计文档模板的 frontmatter 格式（source_prd、generated_by、generated_at 字段由系统自动填入）。
如 PRD 内容不足以推断某项设计决策，在对应章节以 [待确认] 标注，并在"疑问点"中说明缺少的信息。

```

---

## 六、Prompt 维护规范

| 规范 | 说明 |
|------|------|
| 版本管理 | Prompt 修改通过 Git 提交记录追踪，commit message 注明修改原因 |
| 测试验证 | Prompt 修改后至少用 3 个不同场景测试输出质量，确认无退化 |
| 变量占位 | 运行时变量（Issue ID、时间戳等）由胶水服务组装到 User Message 中传入，不写在 System Prompt 的静态文本里 |
| 输出约束 | 所有 Prompt 都以"只输出 X 内容，不输出任何解释性文字"结尾，防止模型输出多余内容 |
