# Dispatch / Callback 可观测性与工作流详情设计

## 背景

ArcFlow 当前已经具备 NanoClaw dispatch、callback、工作流执行记录与详情页，但这条后台异步链路仍然偏“能跑”，还没有达到“可追踪、可诊断、可复盘”的要求。

当前主要问题：

- `dispatch` 表只有最小记账能力，缺少关键时间点、错误摘要、结果摘要和重放痕迹。
- `workflow_execution` 与 `workflow_subtask` 的状态语义比较粗，无法直接说明流程卡在 dispatch、callback 还是后续副作用落地。
- callback 幂等、超时、晚到回调的处理规则没有形成统一可见语义。
- 工作流详情页只展示浅层子任务，无法直接回答“派发出去没有”“回调到了没有”“卡在哪个 target”“产物在哪”。

Issue #121 的目标不是重做整个工作流引擎，而是在保持现有表结构与接口主干稳定的前提下，把 `dispatch / callback` 这条链补齐为可诊断的生产能力。

## 目标

- 统一并落地 `dispatch` 级别的 `pending / running / success / failed / timeout` 状态语义。
- 为所有走 NanoClaw dispatch / callback 的 skill 补齐关键诊断字段和状态落点。
- 让 callback 的幂等、重放、超时、晚到回调都有稳定且可见的处理规则。
- 让工作流详情页直接展示 dispatch、callback、artifact、关联 issue、错误摘要与当前卡点。
- 让联调和生产排障不再依赖人工翻服务日志。

## 非目标

- 不引入新的事件流表，如 `dispatch_event` / `workflow_event`。
- 不把 `workflow_execution` 扩成细粒度状态机。
- 不改造工作流触发入口的业务语义，不新增新的工作流类型。
- 不在本次范围内实现独立的日志检索系统；仅提供日志 URL / 诊断入口的聚合展示。

## 现状与问题拆解

### 1. 顶层状态与异步状态混杂

`workflow_execution` 当前使用 `pending / running / success / failed`，适合表示一次业务流程的总体状态；但异步链路中的真实卡点发生在 dispatch 与 callback 之间。把细粒度状态直接塞进 execution 会导致顶层语义混乱。

### 2. dispatch 账本信息不足

当前 `dispatch` 只能说明“派发过”和“是否最终完成”，但不能说明：

- 是否真正开始处理
- 最近一次 callback 是什么时候
- 失败是上游明确失败还是超时未回调
- callback 是否发生重放
- 回调返回了什么摘要
- 这条 dispatch 从属于哪个 execution、哪个业务阶段

### 3. callback 副作用与账本更新耦合过紧

当前 callback 处理在执行业务副作用时如果抛错，会让“回调其实已经到了”这个事实变得不清晰，也不利于后续重放与排障。

### 4. 工作流详情页缺少排障视角

现有页面能看到基础信息和简单子任务，但仍然需要依赖人工脑补阶段含义，无法直接回答：

- 当前卡在哪一段
- 某条 dispatch 是否已经回调
- 某个 target 的 repo / branch / log / artifact 是什么
- 这次执行由哪次上游执行衍生而来

## 设计原则

### 1. execution 继续做聚合态，dispatch / subtask 承担细粒度诊断

`workflow_execution` 只表达业务流程总体是否在跑、是否成功、是否失败。细粒度链路状态全部落到 `dispatch` 和 `workflow_subtask`，避免顶层状态爆炸。

### 2. 账本先行，业务后置

callback 到达后，先抢占处理权并更新 dispatch 账本，再执行业务副作用。先保证“事实被记录”，再推进“业务被消费”。

### 3. 以现有表结构为主，增量扩展字段与接口

优先扩展现有 `dispatch` / `workflow_subtask` / `workflow_execution detail` 返回，不引入高风险的迁移或重构。

### 4. UI 直接回答排障问题

详情页展示不以数据库表为中心，而以排障问题为中心：当前卡点、dispatch 诊断、target 轨迹、产物与关联链路。

## 数据模型设计

### workflow_execution

`workflow_execution` 继续保留现有高层状态：

- `pending`
- `running`
- `success`
- `failed`

语义如下：

- `pending`：执行已创建，尚未开始推进。
- `running`：执行已经开始，至少有一个阶段正在进行或等待异步结果。
- `success`：整个业务流程已完成。
- `failed`：流程已经确定失败，失败原因写入 `error_message`。

本次不新增 execution 级别的 `timeout` 状态。dispatch timeout 会作为 execution 的失败原因体现，而不是 execution 自身独立状态。

### dispatch

`dispatch` 升级为 NanoClaw 异步任务账本，状态统一为：

- `pending`
- `running`
- `success`
- `failed`
- `timeout`

语义如下：

- `pending`：本地已记账，但尚未被 callback 处理器抢占为处理中。
- `running`：callback 正在被处理，或之前的处理占有权已经建立但尚未终态化。
- `success`：callback 明确成功，且该 dispatch 已终态。
- `failed`：callback 明确失败，或 callback 成功但后续业务副作用落地失败。
- `timeout`：在有效等待窗口内没有拿到有效回调，或已被认定为超时。

建议补充字段：

- `source_execution_id`：该 dispatch 归属的 workflow execution。
- `source_stage`：触发该 dispatch 的业务阶段，如 `dispatch`, `generate`, `bug_analysis`。
- `started_at`：开始处理 callback 的时间戳。
- `last_callback_at`：最近一次 callback 到达时间戳。
- `error_message`：错误摘要，包括上游失败、超时、落地失败等。
- `result_json` 或 `result_summary`：回调成功后保留的结果摘要，至少支持 UI 展示与排障。
- `callback_replay_count`：重复 callback 次数；若不想单独记计数，至少需要能标识发生过 replay。

保留 `plane_issue_id` 与 `timeout_at`，继续作为跨系统关联和超时判断依据。

### workflow_subtask

`workflow_subtask` 继续作为执行内阶段轨迹表，不新建事件流表。它负责承接：

- target 维度的阶段轨迹
- repo / branch / log / artifact 展示
- 与 dispatch 状态同步后的可视化卡点

stage 命名统一收敛为可读、可展示的阶段值，覆盖至少以下场景：

- `dispatch_pending`
- `dispatch_running`
- `callback_success`
- `callback_failed`
- `callback_timeout`
- `generate`
- `generate_failed`
- `ci_pending`
- `ci_success`
- `ci_failed`

其中：

- 对 `code_gen` 这类多 target 流程，subtask 以 target 为维度持久化阶段轨迹。
- 对 `prd_to_tech` / `tech_to_openapi` / `bug_analysis` 这类单次流程，可以只记录 execution 级 dispatch 诊断；若需要统一 UI，也可用一个虚拟 target（如 workflow type）落 subtask。

`output_ref`、`branch_name`、`repo_name`、`log_url`、`error_message` 继续作为主要展示字段，优先保证同一 target 的排障信息聚合完整。

## 状态流转设计

### Dispatch 创建

当 Gateway 向 NanoClaw 派发任务时：

1. 创建 `dispatch` 记录，状态为 `pending`
2. 写入 `source_execution_id`、`source_stage`、`plane_issue_id`、`timeout_at`
3. 如果该 workflow 有 target 维度，则创建或追加 `workflow_subtask(stage=dispatch_pending, status=pending)`
4. `workflow_execution` 保持或切换为 `running`

### Callback 到达

callback 到达后，处理顺序如下：

1. 根据 `dispatch_id` 加载 dispatch 记录
2. 校验 callback 的 `skill` 与落库 skill 是否一致；如果 payload skill 缺失，则以落库 skill 为准
3. 抢占 dispatch 处理权
4. 先更新 dispatch 账本，再执行业务副作用

dispatch 抢占成功后：

- 将 `dispatch.status` 置为 `running`
- 写入 `started_at`
- 写入 `last_callback_at`

如果 callback payload 为成功：

- 先将 dispatch 的结果摘要写入 `result_json/result_summary`
- 将 dispatch 终态置为 `success`
- 然后执行对应 skill 的业务副作用

如果 callback payload 为失败：

- 将 dispatch 的 `error_message` 写入上游错误
- 将 dispatch 终态置为 `failed`
- 将对应 execution / subtask 落到失败轨迹

### Callback 副作用失败

如果 callback 本身成功，但 Gateway 在执行业务副作用时失败，例如：

- 技术设计写入失败
- OpenAPI 写入失败
- codegen 结果解析失败
- 触发下游 workflow 失败

则这不是“回调没到”，而是“回调已到但落地失败”。

处理规则：

- dispatch 保留 callback 已到的事实
- dispatch 最终状态记为 `failed`
- `error_message` 记录副作用失败原因
- 对应 `workflow_execution` 置为 `failed`
- 对应 `workflow_subtask` 写入失败阶段或失败摘要

### Callback 重放与幂等

第一条有效 callback 获得业务处理权，后续相同 `dispatch_id` 的重复 callback 不再重复执行业务副作用。

处理规则：

- 首次有效 callback 正常推进账本与业务
- 后续 replay callback：
  - 不重复写文档
  - 不重复触发下游 workflow
  - 不重复推进 codegen target 状态
- 但要留下可见痕迹：
  - 增加 `callback_replay_count`
  - 或在结果摘要中标注 `duplicate_callback_ignored`

这样联调时可以确认上游发生过重放，而不是静默忽略。

### 超时与晚到回调

本次不引入独立定时任务来持续扫描超时 dispatch，而采用“读时回收 + callback 时纠偏”策略。

规则如下：

- 当系统再次尝试 claim 某条已过 `timeout_at` 的 dispatch 时，允许将其认定为 `timeout`
- `timeout` 会同步反映为对应 execution / subtask 的失败轨迹
- 若 dispatch 超时后又收到晚到 callback：
  - 记录 `last_callback_at`
  - 保留“回调曾到达”的事实
  - 不再推进核心业务副作用
  - 在 dispatch 诊断中标记为 `late_callback_ignored`

这样可以清晰区分三类失败：

- 上游明确失败
- 等待超时未收到回调
- 收到晚到回调但业务已终态

## 各 Skill 的落地语义

### arcflow-prd-to-tech

- dispatch success：写入技术设计文档
- dispatch failed / timeout：execution 失败，错误摘要可见
- 主要展示 execution 级 dispatch 诊断，无需复杂 target 维度

### arcflow-tech-to-openapi

- dispatch success：写入 OpenAPI，并可触发下游 `code_gen`
- dispatch failed / timeout：当前 execution 失败
- 若派生下游 execution，需在 links 中保留 `source_stage`

### arcflow-bug-analysis

- dispatch success：回写 Plane 评论
- dispatch failed / timeout：execution 失败
- 详情页主要展示 dispatch 诊断与 Plane 关联

### arcflow-code-gen

这是本次改造的重点链路。

要求：

- dispatch 创建时为每个 target 生成 `dispatch_pending`
- callback claim 成功后写 `dispatch_running`
- callback success 后写 `callback_success`
- callback failed 后写 `callback_failed`
- callback timeout 后写 `callback_timeout`
- 保留 `repo_name`、`branch_name`、`log_url`、`output_ref`
- 后续 `generate` / `ci_pending` / `ci_success` / `ci_failed` 继续沿用现有轨迹思路

详情页需要按 target 聚合展示这条链路，而不是平铺为无上下文的多行记录。

## 接口设计

优先扩展现有 `GET /api/workflow/executions/:id` 返回，不新开多余端点。

新增/扩展字段：

- `current_stage_summary`
  - 当前卡点摘要
  - 例如：`backend 等待 callback`、`openapi callback timeout`
- `dispatches`
  - 每条 dispatch 的诊断信息集合
- `subtasks`
  - 补全现有字段，保留 target 维度的完整轨迹信息
- `artifacts`
  - 可选；如果不单独新增，可由 `subtasks.output_ref` 统一承载

`dispatches` 每项至少包含：

- `id`
- `skill`
- `status`
- `source_execution_id`
- `source_stage`
- `plane_issue_id`
- `created_at`
- `started_at`
- `last_callback_at`
- `completed_at`
- `timeout_at`
- `error_message`
- `result_summary`
- `callback_replay_count`
- `diagnostic_flags`

其中 `diagnostic_flags` 可用于承载：

- `timed_out`
- `duplicate_callback_ignored`
- `late_callback_ignored`
- `side_effect_failed`

## 工作流详情页设计

详情页按排障视角拆为四块。

### 1. 执行总览

展示：

- 工作流类型
- 触发来源
- execution 状态
- plane issue
- 输入路径
- 创建 / 开始 / 完成时间
- 当前卡点摘要 `current_stage_summary`
- 最近错误摘要

目的：打开页面第一眼知道整体有没有失败、当前堵在哪。

### 2. Dispatch / Callback 诊断

按 dispatch 展示：

- dispatch id
- skill
- 状态
- source stage
- 创建 / 开始 / 最近 callback / 完成时间
- 是否超时
- 是否 replay
- 是否晚到回调
- 错误摘要 / 结果摘要
- 关联 plane issue

目的：直接回答“派发出去没有”“回调到了没有”“是不是重复回调”“是不是超时”。

### 3. Target 轨迹与产物

针对 `code_gen` 这类多 target 执行，按 target 聚合卡片：

- target 名称
- 当前阶段
- 各阶段轨迹
- repo 名称
- branch
- log URL
- artifact / output_ref
- 错误摘要

目的：直接回答“backend 卡在哪”“frontend 的分支和日志在哪”“产物路径是什么”。

### 4. 关联链路

展示：

- source execution → target execution
- link type
- source stage
- 关联 execution 状态

目的：说明当前执行从哪条上游链路派生而来，以及是否已继续触发下游。

## 测试策略

### 后端

需要覆盖：

- dispatch 创建时字段完整落库
- callback 首次成功处理
- callback 首次失败处理
- callback 重放被忽略但可见
- callback 超时后被认定为 timeout
- timeout 后晚到 callback 被记录但不推进副作用
- callback 成功但业务副作用失败时，dispatch / execution / subtask 的终态一致
- `GET /api/workflow/executions/:id` 返回新的诊断字段

### 前端

需要覆盖：

- 详情页正确展示 `current_stage_summary`
- dispatch 诊断区正确展示 timeout / replay / late callback 标记
- target 轨迹按 target 聚合，不是简单平铺 subtasks
- 有 artifact / log / branch 时能正确展示
- 没有 dispatches 或 subtasks 时页面降级合理

## 迁移与兼容性

- SQLite schema 采用增量 `ALTER TABLE` 或初始化补字段方式，兼容已有本地数据。
- 旧的 dispatch 记录没有新字段时，接口需返回 `null` 或合理默认值。
- 前端在新字段缺失时保持可渲染，不因旧数据报错。

## 风险与取舍

### 风险 1：旧数据没有完整轨迹

旧 dispatch 与旧 subtask 无法补出完整的 replay/late callback 历史。解决方式是前端按字段存在性展示，历史数据按“信息不足”处理。

### 风险 2：callback 副作用失败的状态定义容易混淆

本设计明确采用“账本先行，业务后置”，把这类失败定义为 `dispatch failed with side-effect failure`，避免误判为 callback 未到。

### 风险 3：subtask stage 命名不统一

需要在实现时统一 stage 命名与状态映射，否则 UI 会再次回到靠猜测渲染的状态。

## 完成定义

- 所有走 NanoClaw dispatch / callback 的 skill 都能在数据层看到明确 dispatch 终态。
- callback 重放、超时、晚到、失败都能从 UI 或接口直接识别。
- `code_gen` 的 target 维度轨迹、repo、branch、log、artifact 可见。
- 工作流详情页能直接说明当前卡点和失败原因。
- 排障不再依赖翻服务日志才能判断 dispatch / callback 状态。
