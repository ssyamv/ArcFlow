# P0 Closure Design

## 1. 背景

截至 `2026-04-20`，ArcFlow 本仓已经完成到 `Phase 3.6`，主链路
`PRD -> 技术设计 -> OpenAPI -> code_gen -> CI -> bug_analysis` 的仓内闭环已被验证。

当前仍阻塞进入稳定交付状态的 P0 缺口集中在三处：

1. `workflow callback` 的 docs / Plane 写回仍是 Gateway 主入口中的占位实现
2. `prd_to_tech`、`tech_to_openapi`、`bug_analysis` 仍依赖 NanoClaw 独立仓 skill 包的真实 callback 契约
3. ArcFlow 与 NanoClaw 之间缺少被代码和文档共同约束的稳定契约，存在字段漂移风险

本设计只解决这三项，不扩展到自动修复链路、Phase 4 其他稳定性工作或新的业务流程。

## 2. 目标

完成本次 P0 收口后，系统应满足：

- `arcflow-prd-to-tech` 成功回调后，技术设计文档被真实写入 docs repo
- `arcflow-tech-to-openapi` 成功回调后，OpenAPI 文档被真实写入 docs repo
- `arcflow-bug-analysis` 成功回调后，Bug 分析结果被真实评论回 Plane Issue
- ArcFlow 与 NanoClaw 使用一套明确、可测试、可追溯的 callback 契约
- 本地测试可以覆盖成功、失败、字段错误、跨仓契约兼容性

## 3. 非目标

- 不在本次实现中引入“自动修复”执行链路
- 不重构现有 workflow model 或 dispatch model
- 不将 Git webhook 空实现纳入本次 P0
- 不处理历史 `Wiki.js / Dify / Weaviate` 相关路径

## 4. 方案对比

### 方案 A：只在 ArcFlow 侧补正式写回，NanoClaw 保持现状

优点：

- ArcFlow 改动少，落地快

缺点：

- skill 输出格式仍然主要靠约定而不是双侧约束
- 未来 NanoClaw skill 文档或 CLI 改动后，仍可能出现联调回归

### 方案 B：ArcFlow 和 NanoClaw 同步收口 callback 契约

优点：

- 这是唯一能真正关闭 P0 的方案
- docs / Plane 写回与 skill 回调字段一起被测试锁定
- 后续变更时更容易发现契约漂移

缺点：

- 需要跨两个仓库改动
- 测试和文档都要同步维护

### 方案 C：先补契约文档，不改实现

优点：

- 成本最低

缺点：

- 无法解决当前主入口仍是占位实现的问题
- 不能算 P0 完成

**推荐方案：B。**  
P0 的核心不是“写文档”，而是把主链路从“本仓闭环”推进到“跨仓可稳定落地”。这只能通过 ArcFlow 与 NanoClaw 同步收口来完成。

## 5. 总体设计

### 5.1 ArcFlow 侧

在 `packages/gateway` 中新增正式 callback side effects：

- 技术设计文档写回 docs repo
- OpenAPI 文档写回 docs repo
- Bug 分析结果评论回 Plane Issue

这些 side effects 通过 `createCallbackHandler` 的依赖注入接入，替换当前 `index.ts` 中的 `console.log` 占位实现。

### 5.2 NanoClaw 侧

NanoClaw 继续通过 `arcflow-api workflow callback` 调用 Gateway，但 skill 和 CLI 需要与 ArcFlow 正式字段保持一致：

- `arcflow-prd-to-tech` 输出 `tech_doc_path`
- `arcflow-tech-to-openapi` 输出 `openapi_path`
- `arcflow-bug-analysis` 输出结构化分析字段，而不是仅交付一段 Markdown

当前 `arcflow-bug-analysis` skill 文档仍描述返回 `bug_report / severity / fix_attempted`，而 ArcFlow callback 代码实际要求的是 `summary / root_cause / suggested_fix / confidence / next_action` 结构。这是必须消除的契约冲突。

### 5.3 契约文档

增加一份面向当前主线的 callback 契约文档，明确：

- 各 skill 的 dispatch input
- 各 skill 的 success payload
- failed payload 约定
- Gateway side effect 语义
- 字段校验与失败策略

这份文档是未来变更的唯一当前参考，不再依赖分散在 skill 文档和 callback 解析代码中的隐式约定。

## 6. 组件设计

### 6.1 Docs writeback service

在 ArcFlow Gateway 中新增一个专门的 docs writeback service，职责是：

- 根据 `workspaceId` 解析 docs repo 名称
- 确保 repo 已注册且存在本地 checkout
- 将生成结果写入指定相对路径
- 提交并推送到 docs repo

接口建议保持简单：

```ts
writeGeneratedDoc({
  workspaceId,
  relativePath,
  content,
}): Promise<void>
```

不在本次实现中增加复杂 frontmatter 生成逻辑。当前 skill 已生成完整文档内容，Gateway 只负责可靠写回。

### 6.2 Plane comment service

在 ArcFlow Gateway 中补一个明确的 Plane comment 能力，供 callback 直接调用：

```ts
createIssueComment({
  planeIssueId,
  commentHtml,
}): Promise<void>
```

本次不做富样式卡片化，只保证：

- comment 能被成功写入 Plane Issue
- comment 结构稳定、可读

### 6.3 Callback payload parsing

`workflow-callback.ts` 中保留现有 dispatch 状态机逻辑，但调整 skill-specific parsing：

- `arcflow-prd-to-tech`：回调 payload 中读取 `tech_doc_path`，并使用 docs repo 中间落盘路径对应的内容来源策略
- `arcflow-tech-to-openapi`：读取 `openapi_path`
- `arcflow-bug-analysis`：读取结构化字段并渲染为可评论文本

为避免“Gateway 只拿到路径却拿不到内容”的问题，本次契约统一为：

- success callback 必须同时包含 `content` 语义所需的完整输出文本以及产物路径

具体形状：

- `arcflow-prd-to-tech`：`{ tech_doc_path, content, plane_issue_id }`
- `arcflow-tech-to-openapi`：`{ openapi_path, content, plane_issue_id }`
- `arcflow-bug-analysis`：`{ summary, root_cause, suggested_fix, confidence, next_action, plane_issue_id }`

这样 ArcFlow 不需要再回 NanoClaw 容器读取中间文件。

### 6.4 CLI compatibility

`nanoclaw/container/skills/arcflow-api/arcflow-api` 的 `workflow_callback` 子命令当前统一把成功载荷放到 `output` 字段。该行为保留，但调用方 skill 文档与测试必须更新为上述 payload。

ArcFlow `callbackRoutes` 继续兼容：

- `status=success` 时读取 `output`
- `status=failed` 时读取 `error`

不在本次改动回调 HTTP 包裹层字段，只收口 `output` 的内部结构。

## 7. 数据流

### 7.1 `arcflow-prd-to-tech`

1. Plane / Web 触发 dispatch
2. NanoClaw skill 读取 PRD 并生成技术设计 Markdown
3. Skill success callback 发送：
   - `tech_doc_path`
   - `content`
   - `plane_issue_id`
4. Gateway callback：
   - 写入 docs repo
   - 更新 dispatch 成功
   - 如有后续链路，保持现有派生机制

### 7.2 `arcflow-tech-to-openapi`

1. NanoClaw skill 读取技术设计文档并生成 OpenAPI yaml
2. Success callback 发送：
   - `openapi_path`
   - `content`
   - `plane_issue_id`
3. Gateway callback：
   - 写入 docs repo
   - 如当前 execution context 存在，继续触发 `code_gen`

### 7.3 `arcflow-bug-analysis`

1. CI / iBuild failure 派生 `bug_analysis`
2. NanoClaw skill 输出结构化分析结果
3. Success callback 发送：
   - `summary`
   - `root_cause`
   - `suggested_fix`
   - `confidence`
   - `next_action`
   - `plane_issue_id`
4. Gateway callback：
   - 更新 `analysis_ready`
   - 将结构化结果序列化到 workflow detail 可读摘要
   - 评论回 Plane Issue

## 8. 错误处理

- callback 缺少必填字段：立即失败，dispatch 标记 `failed`
- docs repo 写回失败：dispatch 标记 `failed`，execution 状态同步失败
- Plane comment 失败：dispatch 标记 `failed`
- skill 返回与契约不符：作为 side effect failure 处理，不静默降级

本次不采用“部分成功”策略。P0 收口要求 side effect 明确成功，否则视为失败，避免主链路表面成功、实际产物未落地。

## 9. 测试策略

### 9.1 ArcFlow

- `workflow-callback.test.ts`
  - `prd_to_tech` success 会真实调用 docs writeback 依赖
  - `tech_to_openapi` success 会真实调用 docs writeback 依赖
  - `bug_analysis` success 会真实调用 Plane comment 依赖
  - 缺字段时进入失败分支
- 新增或补充 service tests
  - docs writeback service
  - Plane comment service

### 9.2 NanoClaw

- skill / CLI tests
  - `workflow callback` 成功 payload 包含当前契约要求字段
  - `bug_analysis` payload 改为结构化输出，不再沿用旧字段

### 9.3 Cross-repo contract verification

- 以文档为准，双侧测试共同覆盖
- 后续任何 callback shape 变更必须同时改：
  - ArcFlow parser tests
  - NanoClaw sender tests
  - 契约文档

## 10. 风险与取舍

- 风险：跨两个仓库的改动会增加一次性变更面
  - 取舍：这是关闭 P0 的必要成本，不能只改单边
- 风险：docs writeback 与 skill 生成路径语义不一致
  - 取舍：统一要求 callback 同时携带内容与路径，避免 ArcFlow 回读容器内文件
- 风险：Plane comment 的 HTML / Markdown 能力与预期不一致
  - 取舍：先以最小可读评论落地，不做复杂富文本

## 11. 实施范围总结

本次实施将修改：

- ArcFlow Gateway callback side effects
- ArcFlow docs / Plane service 层
- NanoClaw skill 文档与 callback payload
- NanoClaw `arcflow-api` CLI 相关测试
- 当前主线契约文档

本次实施不会修改：

- Web 页面交互
- 自动修复执行器
- Git webhook 空实现
- 生产部署拓扑
