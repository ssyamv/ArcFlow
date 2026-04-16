> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 多端代码生成策略设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 问题

ArcFlow 涉及四条技术线（后端 Spring Boot、Vue3 Web、Flutter 移动端、Android 客户端），代码生成需要明确各端的生成顺序、依赖关系、输入输出和具体规则。

### 关键前提

- 移动端和 Web 是不同的功能不同的页面，互不影响
- 一个 PRD 的"涉及端"通常只勾选相关的端（如后端 + Vue3，或后端 + Flutter），不会同时生成 Vue3 和 Flutter 的 UI 代码
- 后端是共用的（提供接口），各前端/客户端各自对接

---

## 二、生成顺序与触发规则

### 2.1 两轮生成策略

采用后端先行、前端跟进的两轮策略：

| 轮次 | 生成内容 | 触发条件 | 输入 |
|------|---------|---------|------|
| 第一轮 | 后端代码 | 技术文档 Review 通过 | CLAUDE.md + 技术设计文档 + OpenAPI yaml |
| 第二轮 | 前端/客户端 UI 代码 | 后端 MR 合并 + Figma 设计稿已交付 | CLAUDE.md + 技术设计文档 + OpenAPI yaml + Figma 设计稿 |

### 2.2 选择后端先行的理由

- OpenAPI yaml 定义了接口规范，但后端代码生成过程中可能微调接口（新增字段、调整错误码）
- 后端 MR 经研发 Review 确认接口无误后，前端基于已确认的接口生成代码，减少不一致
- 前端各端之间无依赖，逻辑上可并行，但受 Claude Code 资源限制，实际串行执行（避免同时启动多个进程争抢资源）

### 2.3 执行流程

```text
技术文档 Review 通过
  → 第一轮：后端代码生成
  → 后端 MR 提交 → 研发 Review → 合并
  → 检查第二轮触发条件：
    条件 1：后端 MR 已合并（Git Webhook 监听 merge 事件）
    条件 2：PRD 设计稿状态为"已交付"
  → 两个条件都满足 → 自动触发第二轮
  → 仅条件 1 满足 → 等待设计稿交付后手动触发（NanoClaw 或 /api/workflow/trigger）
  → 第二轮：前端/客户端 UI 代码生成（涉及多端时串行执行）
  → 各端 MR 提交 → 研发 Review / 微调

```

### 2.4 如果 PRD 不涉及后端

某些 PRD 可能仅涉及前端改动（如纯 UI 优化），此时跳过第一轮，设计稿交付后直接触发第二轮。胶水服务根据 PRD "涉及端"字段判断是否需要后端生成。

不涉及后端时的触发流程：

```text
技术文档 Review 通过
  → 胶水服务检测 PRD "涉及端"不包含后端
  → 检查设计稿状态：
    → 已交付 → 直接触发第二轮（前端/客户端代码生成）
    → 未交付 → 记录状态，等待手动触发（NanoClaw 或 /api/workflow/trigger）

```

> 注意：设计稿交付状态由设计师在 PRD 文档中手动更新（Figma 链接 + 状态改为"已交付"），没有自动通知机制。胶水服务不轮询设计稿状态，依赖人工触发。

---

## 三、各端生成规则

### 3.1 后端（Spring Boot）

| 项 | 说明 |
|----|------|
| 输入 | 技术设计文档 + OpenAPI yaml |
| 生成范围 | Entity + Mapper + Service + ServiceImpl + Controller + DTO + 建表 SQL |
| 分支命名 | `feature/{issue-id}-backend` |
| 不生成 | 测试代码（第一版不要求 AI 写测试，研发手动补充） |

### 3.2 Vue3 Web 前端

| 项 | 说明 |
|----|------|
| 输入 | 技术设计文档 + OpenAPI yaml + Figma 设计稿（通过 Figma MCP） |
| 生成范围 | 页面组件 + 页面级私有组件 + API 调用函数 + 路由配置 + Store（如需要） |
| 分支命名 | `feature/{issue-id}-vue3` |
| 组件库策略 | 新项目优先 shadcn-vue；老项目保持与已有页面一致（如已使用 Element Plus 则继续用 Element Plus） |

### 3.3 Flutter 移动端

| 项 | 说明 |
|----|------|
| 输入 | 技术设计文档 + OpenAPI yaml + Figma 设计稿（通过 Figma MCP） |
| 生成范围 | View + Controller + Binding + API 调用 + Model + 路由注册 |
| 分支命名 | `feature/{issue-id}-flutter` |
| Figma 映射 | Flutter 原生 Widget + 项目自定义组件 |

### 3.4 Android 客户端

| 项 | 说明 |
|----|------|
| 输入 | 技术设计文档 + OpenAPI yaml + Figma 设计稿（通过 Figma MCP） |
| 生成范围 | Screen（Compose）+ ViewModel + Repository + API 接口定义 + DTO/UiState + Hilt Module |
| 分支命名 | `feature/{issue-id}-android` |
| UI 框架 | 新页面使用 Jetpack Compose；维护旧页面保持 XML |
| Figma 映射 | Material 3 Compose 组件优先 |

---

## 四、Claude Code 任务描述模板

胶水服务在调用 Claude Code 时，需要组装完整的任务描述。变量使用 `{variable_name}` 格式，由胶水服务在调用前替换。

> **职责边界**：分支创建、commit、push、创建 MR 均由胶水服务完成。Claude Code 任务描述只负责代码生成，不负责任何 Git 操作。

### 4.1 后端任务描述

```text
你的任务是根据以下文档生成 Spring Boot 后端代码。

## 技术设计文档
{tech_design_content}

## OpenAPI 规范
{openapi_content}

## 要求
1. 严格遵循本仓库 CLAUDE.md 中的分层架构、包结构、命名规范
2. 生成完整的 Entity、Mapper、Service、ServiceImpl、Controller、DTO
3. 生成建表 SQL 文件放在 src/main/resources/db/ 目录下
4. 不生成测试代码
5. 在已有项目结构基础上新增文件，不修改现有代码（除非技术设计文档"涉及的现有模块改动"中明确指出）

```

### 4.2 Vue3 前端任务描述

```text
你的任务是根据以下文档和 Figma 设计稿生成 Vue3 页面代码。

## 技术设计文档
{tech_design_content}

## OpenAPI 规范
{openapi_content}

## Figma 设计稿
请通过 Figma MCP 读取设计稿：{figma_url}

## 要求
1. 严格遵循本仓库 CLAUDE.md 中的组件规范和样式规范
2. 生成页面组件、私有组件、API 调用函数、路由配置
3. 新项目组件库优先使用 shadcn-vue；如果项目中已有页面使用 Element Plus，则保持一致使用 Element Plus
4. 从 Figma 提取的颜色和间距映射到项目已有的样式变量，不使用硬编码值
5. API 调用函数的请求/响应类型必须与 OpenAPI 规范一致

```

### 4.3 Flutter 移动端任务描述

```text
你的任务是根据以下文档和 Figma 设计稿生成 Flutter 页面代码。

## 技术设计文档
{tech_design_content}

## OpenAPI 规范
{openapi_content}

## Figma 设计稿
请通过 Figma MCP 读取设计稿：{figma_url}

## 要求
1. 严格遵循本仓库 CLAUDE.md 中的分层规范和 GetX 使用规范
2. 生成 View、Controller、Binding、API 调用、Model、路由注册
3. 从 Figma 提取的颜色和间距映射到 app/theme/ 中的主题变量
4. Model 类必须实现 fromJson/toJson
5. 使用 Binding 模式注入 Controller，不直接 Get.put()

```

### 4.4 Android 客户端任务描述

```text
你的任务是根据以下文档和 Figma 设计稿生成 Android 页面代码。

## 技术设计文档
{tech_design_content}

## OpenAPI 规范
{openapi_content}

## Figma 设计稿
请通过 Figma MCP 读取设计稿：{figma_url}

## 要求
1. 严格遵循本仓库 CLAUDE.md 中的 MVVM + Compose 规范
2. 新页面使用 Jetpack Compose，不使用 XML 布局
3. 生成 Screen、ViewModel、Repository、API 接口定义、DTO/UiState、Hilt Module
4. 从 Figma 提取的颜色和间距映射到 MaterialTheme 主题变量
5. UI 状态使用 StateFlow，Compose 中通过 collectAsStateWithLifecycle() 收集

```

---

## 五、胶水服务流程调整

### 5.1 对流程 C（代码生成）的修订

原流程 C 为审批通过后一次性生成所有端的代码。修订为两轮：

**第一轮（审批通过后立即触发）**：

```text
审批通过
  → 从 PRD "涉及端"字段提取目标端列表
  → 如果包含后端:
    → clone/pull 后端仓库
    → 组装后端任务描述
    → Bun.spawn: Claude Code headless
    → 创建分支 feature/{issue-id}-backend + commit + push + 创建 MR
    → 飞书通知研发 Review 后端 MR
  → 如果不包含后端:
    → 直接进入第二轮检查

```

**第二轮（后端 MR 合并后触发）**：

```text
Git Webhook (MR merged, branch matches feature/{issue-id}-backend)
  → 检查 PRD 设计稿状态
  → 已交付:
    → 遍历 PRD 中除后端以外的"涉及端"
    → 对每个前端/客户端端（串行执行）:
      → clone/pull 目标仓库
      → 组装对应端的任务描述（含 Figma 链接）
      → Bun.spawn: Claude Code headless（含 Figma MCP 配置）
      → 创建分支 feature/{issue-id}-{端名} + commit + push + 创建 MR
    → 飞书通知研发 Review 各端 MR
  → 未交付:
    → 记录状态，等待手动触发

```

### 5.2 新增的 Webhook 监听

胶水服务需要新增对 Git MR merge 事件的监听。匹配规则：

- **仓库过滤**：仅监听后端代码仓库的 merge 事件
- **分支匹配**：合并的源分支匹配 `feature/{issue-id}-backend` 模式
- **重新生成**：同一 Issue 重新生成后端代码时，分支命名不变（覆盖式 force push），不追加版本号

### 5.3 对胶水服务数据模型的影响

`workflow_execution` 表已能支持两轮生成，通过 `workflow_type` 区分：
按端细分 `workflow_type`，支持按端粒度追踪和重试：

- `code_gen_backend`
- `code_gen_vue3`
- `code_gen_flutter`
- `code_gen_android`

---

## 六、分支与 MR 管理

| 规则 | 说明 |
|------|------|
| 分支命名 | `feature/{issue-id}-{端名}`，如 `feature/ISSUE-123-backend` |
| MR 标题 | `[AI 生成] {功能名称} - {端名}`，如 `[AI 生成] 用户注册 - backend` |
| MR 描述 | 自动填入：关联 Issue、技术设计文档链接、生成模型、生成时间 |
| 每端独立 MR | 各端代码提交到各自仓库的独立分支，研发可以按端独立 Review |
| MR 合并 | 人工合并，不自动合并 |
