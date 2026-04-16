# ArcFlow + NanoClaw 首期端到端落地设计

- 日期：2026-04-16
- 状态：Draft，待用户评审
- 范围：ArcFlow 仓库 + NanoClaw 仓库 + 生产部署/联调

## 1. 背景

当前 ArcFlow 已完成 Web、Gateway、Plane 集成与 NanoClaw 接入的基础能力，但距离“生产可用的真实闭环”还差最后一公里。现状主要缺口有三类：

1. NanoClaw 缺少 ArcFlow 专用业务 skill，Web AiChat 还不能稳定完成真实业务查询与写入。
2. Plane 审批后的自动流程虽然已有 dispatch/callback 基础设施，但还未形成稳定、可验收的生产闭环。
3. 生产部署说明、NanoClaw 运行时稳定性和联调收口仍存在漂移，导致系统“有代码”但不等于“可连续运行”。

本设计定义一个首期交付范围：在不纳入代码生成和 CI 闭环的前提下，先把 ArcFlow + NanoClaw 做到生产可用，打通用户可见链路和后台自动链路，并把联调中发现的阻断性问题一并收口。

## 2. 首期目标

首期只聚焦两条主链路：

1. **交互链路**
   Web AiChat 通过 NanoClaw 调用 ArcFlow 专用 skill，完成真实只读查询和受控写入。

2. **自动链路**
   Plane Issue 进入 Approved 后，由 Gateway 自动创建 dispatch，NanoClaw 执行非交互 skill，完成文档落盘、通知与状态更新。

同时，首期必须满足“生产可用”而不是“本地能跑”，因此部署文档漂移、NanoClaw 运行时阻断问题和联调暴露的关键缺陷都属于首期范围。

## 3. 非目标

以下内容明确不属于首期：

- `PRD → 技术设计 → OpenAPI → 代码生成 → CI` 全链路闭环
- 代码生成 skill、Claude Code 自动修复、CI 失败自动回流的完整生产收口
- NanoClaw 的性能专项优化（如容器池、冷启动加速）作为独立目标推进
- 对 Plane、Git、数据库的直连调用从 NanoClaw 发起
- 一次性解决所有历史文档、所有旧设计文档中的遗留术语漂移

首期只修复会阻断两条主链路上线或稳定运行的问题。

## 4. 推荐方案

本设计采用“三段式交付”：

1. **arcflow-api 交互 MVP**
   先建立用户可见能力，让 Web AiChat 能真实调用 ArcFlow 业务接口。

2. **Plane 自动审批闭环**
   再建立后台自动链路，确保 Approved 事件能触发稳定的 skill 执行与 callback 落盘。

3. **联调与生产稳定性收口**
   最后围绕真实环境修复 NanoClaw 与部署层问题，完成生产验收。

不采用“先全面稳定性治理再接业务”的路线，因为 NanoClaw 很多问题只有在真实业务链路压上去之后才会暴露；也不采用“先把东西接起来再说”的路线，因为跨仓库、跨系统的临时兼容会在后续演化中留下高成本技术债。

## 5. 架构边界

### 5.1 ArcFlow Web

- 提供 AiChat 入口、消息展示、状态展示和跳转入口
- 不直接承担工作流编排
- 不直接访问 Plane、Git 或 NanoClaw 内部运行态

### 5.2 NanoClaw

- 负责 Agent 推理、skill 路由、会话上下文和 Web/飞书交互
- 所有 ArcFlow 业务动作通过 skill 发起
- 不直接写 ArcFlow 数据库、Git 仓库、Plane 或飞书

### 5.3 Gateway

- 作为唯一系统副作用出口
- 负责 Plane API、Git 文档写入、飞书通知、dispatch 记账、callback 幂等
- 对外暴露给 NanoClaw 的是稳定 HTTP 契约，而不是内部实现细节

### 5.4 Plane

- 作为需求、审批状态和项目上下文来源
- 不承载 ArcFlow 专属业务逻辑
- 通过 webhook 提供状态变更事件

### 5.5 docs Git

- 只保存最终产物，如 PRD、技术设计、OpenAPI 等
- 不保存 Agent 私有中间态或会话态

这个边界划分的核心原则是：**NanoClaw 决策，Gateway 执行副作用**。这样当链路出问题时，可以快速区分是 Agent 层问题、Gateway 契约问题还是外部系统问题。

## 6. 子项目拆分

### 6.1 子项目 A：`arcflow-api` 交互链路

目标是让 Web AiChat 通过 NanoClaw 真实调用 ArcFlow 能力，建立生产可用的用户入口。

首期工具范围限定为最小可用集：

- 只读：
  - `get_workspace_info`
  - `search_docs`
  - `list_my_issues`
- 写入：
  - `create_requirement_draft`

写入能力必须默认 `dryRun`，只有用户明确确认后才能真正执行。skill 返回结果必须结构化，并附带跳转链接，供 Web 渲染为卡片或操作入口。

### 6.2 子项目 B：Plane 自动审批闭环

目标是让 Approved 状态真正成为后台自动流程的可信触发器，而不是“理论上可用”。

首期只打通一条自动链：

`Plane Approved → Gateway dispatch → NanoClaw non-interactive skill → Gateway callback → 技术文档落盘 + 通知`

这条链路不强行纳入 OpenAPI、代码生成和 CI，避免首期范围膨胀。

### 6.3 子项目 C：联调与生产稳定性收口

目标是让前两条链路在真实生产环境中可重复、可诊断、可恢复。

范围包括：

- NanoClaw 会话、IPC、gateway 连接等运行时问题
- 部署文档和脚本与真实生产拓扑不一致的问题
- 联调中新增发现的阻断性故障

范围不包括没有影响首期链路上线的纯性能优化或未来能力预建设。

## 7. 关键数据流

### 7.1 交互链路

```text
Web AiChat
  → NanoClaw 会话
  → arcflow-api skill
  → Gateway HTTP API
  → Gateway 读取/写入 Plane、docs、workspace 数据
  → skill 返回结构化结果
  → Web 渲染 text/card/status
```

### 7.2 自动链路

```text
Plane Issue 状态变更为 Approved
  → Plane webhook 到 Gateway
  → Gateway 校验并创建 dispatch
  → NanoClaw 执行 arcflow-prd-to-tech 等非交互 skill
  → skill 完成后 POST /api/workflow/callback
  → Gateway 幂等落盘、发通知、更新状态
```

## 8. Gateway 契约原则

首期不要求一次性补齐所有 ArcFlow API，但必须建立清晰契约。

契约原则如下：

1. **NanoClaw 只调用 HTTP API**
   不透传数据库语义，不暴露内部表结构。

2. **所有写入接口必须具备幂等或确认机制**
   至少包括 `dryRun`、`idempotencyKey`、callback 幂等。

3. **dispatch/callback 必须有明确状态机**
   至少区分 `pending`、`running`、`success`、`failed`、`timeout`。

4. **返回结果以结构化 JSON 为主**
   由 NanoClaw 或 Web 层负责最终表现形式，不把 UI 文案塞进 Gateway。

## 9. 生产稳定性原则

联调和上线阶段，所有问题按以下优先级处理：

1. 阻断主链路的故障必须修复
   例如 session 丢失导致对话不可继续、callback 无法落盘、gateway 在 worker 内不可达。

2. 可能导致重复写入或数据不一致的问题必须修复
   例如 callback 重放、写入失败后状态误报成功。

3. 纯性能问题只有在已经影响生产可用性时才进入首期
   例如冷启动过慢导致超时或用户误判失败。

4. 非阻断的历史遗留问题记录为第二阶段技术债

## 10. 首期完成定义

首期完成必须同时满足以下 5 条：

1. Web AiChat 可以完成一次真实只读查询。
2. Web AiChat 可以完成一次真实需求草稿创建确认。
3. Plane `Approved` 可以自动生成并落一份技术文档。
4. Gateway 可以完整记录 dispatch 与 callback 状态。
5. 生产环境连续验证时，不再出现阻断式 NanoClaw 故障。

## 11. 测试与验收策略

### 11.1 单元与契约测试

- `arcflow-api` 的每个工具必须覆盖成功、空结果、Gateway 错误
- Gateway 新增或调整接口必须有契约测试
- callback 路由必须验证幂等与鉴权

### 11.2 集成测试

- Web → NanoClaw → Gateway 的真实调用链至少覆盖 1 个只读和 1 个写入动作
- Plane webhook → dispatch → callback → 技术文档落盘至少覆盖 1 次完整执行

### 11.3 生产验证

生产验证只看首期目标，不扩张测试矩阵：

- 人工发起一次 AiChat 查询
- 人工发起一次需求草稿创建确认
- 在 Plane 中将一条 Issue 置为 Approved
- 验证技术文档产物、通知、dispatch 状态一致
- 复测至少一次，确认不是偶发成功

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| NanoClaw 与 Gateway 契约频繁漂移 | 先定义最小工具集和最小 callback 契约，再推进实现 |
| 写入能力被误触发产生脏数据 | 默认 `dryRun` + 明确确认 + 幂等键 |
| 自动链路成功但结果不可见 | callback 落盘、通知和状态更新绑定为同一验收单元 |
| 生产环境与仓库文档不一致 | 把部署对齐列入首期，不作为“后补文档” |
| 联调问题无限扩张 | 只收口阻断首期目标的问题，其余转入第二阶段 |

## 13. 实施顺序

建议执行顺序如下：

1. 梳理并冻结首期 Gateway 契约
2. 落 `arcflow-api` 最小工具集
3. 打通 Plane 自动审批闭环
4. 做 Web 展示与结果卡片化最小适配
5. 联调并收口 NanoClaw/部署问题
6. 生产验证并形成验收记录

## 14. 第二阶段入口

首期完成后，第二阶段再考虑以下内容：

- `PRD → 技术设计 → OpenAPI` 的完整自动链扩展
- 代码生成与 CI 闭环
- NanoClaw 冷启动优化、容器池、性能专项
- 更丰富的 `arcflow-api` 工具集
