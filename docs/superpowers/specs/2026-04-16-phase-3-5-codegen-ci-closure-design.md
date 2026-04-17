> 文档状态：Draft，待用户评审。本设计只覆盖 issue #120 的 `PRD → 技术设计 → OpenAPI → 代码生成 → CI` 后半段闭环，不替代项目总览与首期 Phase 1 文档。

# Phase 3.5: PRD → 技术设计 → OpenAPI → 代码生成 → CI 后半段闭环设计

- 日期：2026-04-16
- 状态：Draft，待用户评审
- 关联 Issue：#120
- 范围：ArcFlow Gateway + Web，兼容 NanoClaw dispatch/callback 主线

## 1. 背景

当前 ArcFlow 已完成前半段主线的基础联调：

- `prd_to_tech`
- `tech_to_openapi`
- `bug_analysis`

这三类能力已逐步切到 `Gateway 编排 + NanoClaw skill + callback 回写` 的主路径。相对地，`code_gen` 仍保留在 Gateway 内部直跑 Claude Code 的旧模式，CI 回流也还是按 webhook 来源分别处理，尚未挂到同一条主执行链路上。

这导致系统当前存在三个明显断点：

1. `code_gen` 是旁路执行，和 `prd_to_tech / tech_to_openapi` 的 dispatch/callback 模型不一致。
2. `/webhook/cicd` 与 `/webhook/ibuild` 各自处理结果，ArcFlow 侧缺少统一的 CI 状态回写协议。
3. Web 只能看到粗粒度工作流状态，无法判断 `code_gen` 卡在生成、分支推送还是 CI。

issue #120 的目标不是推翻现有工作流模型，而是在保持外部心智稳定的前提下，把后半段真正接到主线上。

## 2. 目标

本阶段目标是把如下链路打通为可重复执行、可追踪、可展示的闭环：

`PRD → 技术设计 → OpenAPI → code_gen → CI`

完成后必须满足：

1. `tech_to_openapi` 成功后可以自然衔接到 `code_gen`。
2. `code_gen` 对外仍作为单一主节点展示，但内部可按端别和阶段跟踪。
3. `/webhook/cicd` 与 `/webhook/ibuild` 两类 CI 入口统一回写到同一条执行链路。
4. CI 失败时可以从 `code_gen` 派生 `bug_analysis`，而不是变成孤立事件。
5. ArcFlow Web 能在不推翻现有页面结构的前提下展示后半段执行进度与失败位置。

## 3. 非目标

本阶段明确不做以下事情：

- 修改 `prd_to_tech / tech_to_openapi / bug_analysis` 的对外工作流名称
- 把 Web 列表页和 Dashboard 改造成细粒度多节点编排画布
- 一次性接入所有未来目标端或补齐所有自动修复策略
- 对历史执行数据做重型迁移或回填
- 把所有 CI 系统统一成同一个外部 webhook 协议

本设计只关心 ArcFlow 内部如何统一收口这些能力。

## 4. 方案选择

### 4.1 备选方案

本次讨论过三条路线：

1. 轻量补丁型  
   保留 `code_gen` 单节点，把端别、阶段、CI 信息塞进现有执行记录的扩展字段。

2. 分层状态机型  
   对外仍保留 `code_gen` 单节点，对内新增阶段状态与子任务记录，让生成、推分支、CI 等都挂到同一主执行下。

3. 全量枚举型  
   对内对外都拆成 `code_gen_backend / code_gen_vue3 / ci_verify` 等细粒度工作流类型。

### 4.2 推荐方案

采用第二种，也就是“分层状态机型”。

原因：

- 对外兼容现有 API、前端筛选项和用户心智。
- 对内能表达 `backend`、`vue3`、`flutter`、`android` 等目标端的阶段状态。
- 后续继续接 `bug_analysis`、自动修复重试、更多 CI 源时，不需要再次推翻模型。

不采用方案 1，是因为查询和展示会越来越依赖松散 metadata；不采用方案 3，是因为会把现有前后端类型枚举和历史兼容全部打散。

## 5. 架构边界

这次收口之后，各层职责如下：

### 5.1 NanoClaw

- 负责智能执行本身，包括代码生成与故障分析
- 通过 skill 执行任务，并通过 callback 回传结果
- 不直接维护 ArcFlow 工作流状态机

### 5.2 Gateway

- 作为唯一工作流编排和状态持久化中心
- 创建主执行、子任务、派生关系
- 负责 dispatch、callback、Git 分支推送登记、CI 回写映射
- 统一处理 `/webhook/cicd` 与 `/webhook/ibuild`

### 5.3 Web

- 继续展示主执行列表与详情
- 不直接理解 NanoClaw skill 层细节
- 只消费 Gateway 聚合后的主状态、子任务和链路关系

### 5.4 CI 外部系统

- 仍可以保留自己的 webhook 格式
- 只要 Gateway 能把事件映射成统一内部 CI 回写协议即可

核心原则保持不变：**NanoClaw 负责生成和分析，Gateway 负责编排、持久化、回写和系统适配。**

## 6. 数据模型

### 6.1 现有主表保持不变

`workflow_execution` 继续作为对外主执行记录，保留现有主类型：

- `prd_to_tech`
- `tech_to_openapi`
- `code_gen`
- `bug_analysis`

这样现有列表页、Dashboard、筛选项和手动触发接口不需要被迫重命名。

### 6.2 新增 `workflow_subtask`

新增一张子任务表表达 `code_gen` 内部阶段状态。

建议字段：

- `id`
- `execution_id`
- `stage`
- `target`
- `provider`
- `status`
- `input_ref`
- `output_ref`
- `external_run_id`
- `branch_name`
- `repo_name`
- `log_url`
- `error_message`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

字段含义：

- `stage`：阶段，例如 `dispatch`、`generate`、`branch_push`、`ci_pending`、`ci_running`、`ci_success`、`ci_failed`
- `target`：目标端，例如 `backend`、`vue3`、`flutter`、`android`
- `provider`：执行或回写来源，例如 `nanoclaw`、`generic_cicd`、`ibuild`
- `status`：子任务当前状态，例如 `pending`、`running`、`success`、`failed`

### 6.3 新增 `workflow_link`

新增执行关系表表达主链路与派生链路之间的关联。

建议字段：

- `id`
- `source_execution_id`
- `target_execution_id`
- `link_type`
- `metadata`
- `created_at`

典型关系包括：

- `tech_to_openapi -> code_gen`，`link_type=derived_from`
- `code_gen -> bug_analysis`，`link_type=spawned_on_ci_failure`

这样详情页可以展示“由谁触发、后续触发了谁”，不需要在主执行表里堆叠越来越多的关联字段。

## 7. 状态流转

### 7.1 主执行状态

`workflow_execution.status` 继续只表达主状态：

- `running`
- `success`
- `failed`

其中 `code_gen` 的判定规则如下：

- 任一目标端子任务启动后，主执行进入 `running`
- 所有必需目标端生成完成且最终 CI 成功后，主执行进入 `success`
- 任一必需目标端在生成阶段失败，或最终 CI 失败且未被后续修复闭环接管时，主执行进入 `failed`

本阶段不引入 `partial_success`，避免前后端状态扩散。

### 7.2 `code_gen` 内部状态机

推荐的内部阶段顺序为：

`dispatch -> generate -> branch_push -> ci_pending -> ci_running -> ci_success/ci_failed`

说明：

- `dispatch`：Gateway 已创建子任务并发起 NanoClaw dispatch
- `generate`：NanoClaw 正在执行代码生成
- `branch_push`：代码已写入目标仓库，正在登记或推送分支
- `ci_pending`：已形成待验证产物，等待 CI 系统接单
- `ci_running`：已收到 CI 开始事件
- `ci_success / ci_failed`：CI 结束并已映射回写

### 7.3 派生关系

`bug_analysis` 不再直接由孤立 CI 事件触发，而是只在统一 CI 回写把某个 `code_gen` 子任务标记为 `ci_failed` 后，由 Gateway 派生创建新的主执行。

这使得后续链路可以清晰呈现为：

`tech_to_openapi success -> code_gen -> ci_failed -> bug_analysis`

## 8. 触发与职责边界

### 8.1 主链路自动触发

当 `tech_to_openapi` callback 成功后，Gateway 自动创建 `code_gen` 主执行，并根据 workspace 配置或调用参数生成一个或多个目标端子任务。

这一步是后半段主链路的正式入口。

### 8.2 手动触发

保留现有 `POST /api/workflow/trigger` 中的 `workflow_type=code_gen`，但内部语义调整为：

1. 创建 `code_gen` 主执行
2. 创建目标端子任务
3. 发起统一 dispatch

而不是像现在一样在 Gateway 内部直接把生成逻辑跑到底。

### 8.3 统一执行器策略

`code_gen` 与 `prd_to_tech / tech_to_openapi / bug_analysis` 一样，统一走：

`Gateway dispatch record -> NanoClaw skill -> /api/workflow/callback`

Gateway 保留的系统职责包括：

- 创建执行记录和子任务
- 记录 dispatch 与 callback
- 在必要时登记 Git 分支/MR 信息
- 推进 CI 阶段状态

不再让 `code_gen` 继续成为唯一的 Gateway 直跑旁路。

## 9. 统一 CI 回写协议

### 9.1 内部标准事件

不论来源是 `/webhook/cicd` 还是 `/webhook/ibuild`，Gateway 都先映射成统一的内部 CI 事件，再推进状态。

建议统一字段：

- `execution_id?`
- `plane_issue_id?`
- `target`
- `provider`
- `external_run_id`
- `status`
- `log_summary`
- `log_url`
- `raw_payload`

其中：

- `provider` 为 `generic` 或 `ibuild`
- `status` 为 `pending`、`running`、`success`、`failed`

### 9.2 关联策略

如果 incoming 事件没有 `execution_id`，按以下优先级关联：

1. `plane_issue_id + target`
2. `branch + repo`
3. 其他可用的 commit 或外部流水号映射

若仍无法定位，则只记录 webhook log，不更新主链路，避免误关联污染工作流状态。

### 9.3 双入口统一收口

- `/webhook/cicd`：直接解析通用 CI 事件并映射到统一内部协议
- `/webhook/ibuild`：保留现有日志抓取与适配逻辑，但抓取完成后也回写成同一内部协议

这样 ArcFlow 内部只保留一套 CI 状态推进逻辑。

## 10. API 与存储兼容策略

### 10.1 保持兼容的 API

以下接口保持现有主语义：

- `GET /api/workflow/executions`
- `GET /api/workflow/executions/:id`
- `POST /api/workflow/trigger`

### 10.2 增量增强

建议如下增强：

1. `GET /api/workflow/executions`
   返回结构尽量保持不变，只增加可选摘要字段，例如目标端完成情况或最新 CI 摘要。

2. `GET /api/workflow/executions/:id`
   在现有 execution 基础上追加：
   - `subtasks`
   - `links`

3. `POST /api/workflow/trigger`
   `workflow_type=code_gen` 时支持可选参数：
   - `targets`
   - `source_execution_id`
   - `source_stage`

本阶段不急着把子任务更新接口暴露成公共 API，先在 Gateway 内部 service 层统一推进。

## 11. Web 展示策略

### 11.1 列表页与 Dashboard

继续显示主工作流类型，不把前端心智切成大量细粒度节点。

可增加的摘要信息包括：

- `2/3 目标完成`
- `CI 失败`
- `等待 CI`

### 11.2 详情页

`WorkflowDetail` 增加一个“阶段时间线/子任务表”区域，按 `target + stage` 展示：

- 当前阶段
- 分支名或仓库名
- provider
- CI 状态
- 日志链接
- 错误信息
- 派生出的 `bug_analysis` 链路

这能在不重做页面的前提下，把排障所需的关键信息暴露出来。

## 12. 错误处理与幂等

### 12.1 错误边界

必须严格区分两类失败：

1. 生成阶段失败  
   例如 NanoClaw 生成失败、分支推送失败。此时对应子任务与主执行直接标记失败，不触发 `bug_analysis`。

2. CI 阶段失败  
   只有子任务已进入 `ci_running` 后收到统一 CI 失败事件，才派生 `bug_analysis`。

这样自动修复只处理真实构建/测试失败，不会吞掉代码生成阶段的问题。

### 12.2 幂等要求

需要三层幂等：

1. dispatch 幂等  
   同一个 `execution_id + target + stage=generate` 只允许一个活跃 dispatch。

2. webhook 幂等  
   `/webhook/cicd` 继续按事件头去重，`/webhook/ibuild` 继续按 `buildId` 去重，但最终都落到同一个 CI 事件 upsert 逻辑。

3. callback 幂等  
   `/api/workflow/callback` 对 `code_gen` callback 也必须先 claim 再执行 side effects，防止重复写分支、重复推进状态。

## 13. 验收口径

本阶段至少要完成一轮真实的后半段联调，而不是只补单元测试。

验收标准：

1. 从一个已成功的 `tech_to_openapi` 产物可以触发 `code_gen` 主执行。
2. 至少一个目标端完成代码生成，并登记可追踪的分支或 MR 信息。
3. 通过 `/webhook/cicd` 或 `/webhook/ibuild` 任一入口可把 CI 成功结果回写到同一条主执行上，ArcFlow Web 可见。
4. 再模拟一轮 CI 失败，验证会派生 `bug_analysis`，并在详情页看到链路关系。
5. 相关接口、状态推进、列表页与详情页测试通过。

## 14. 实施建议

建议按以下顺序实施：

1. 数据层
   新增 `workflow_subtask` 与 `workflow_link`，补基础查询与写入 API。

2. Gateway 编排层
   重构 `code_gen` 为 dispatch/callback 模式，补统一 CI 回写 service。

3. Web 展示层
   在详情页补子任务和链路展示，在列表页补摘要。

4. 验证层
   补单元/集成测试，并执行一轮后半段端到端验收。

## 15. 完成定义

本设计对应的 Phase 3.5 完成定义为：

- 对外仍然只有 `code_gen` 主节点
- 对内可按端别和阶段跟踪生成与 CI 进度
- `/webhook/cicd` 与 `/webhook/ibuild` 统一回写到同一条工作流主链路
- `bug_analysis` 只从 `ci_failed` 派生
- ArcFlow Web 可查看后半段执行过程和失败位置

这意味着 ArcFlow 的主链路从“前半段可联调，后半段旁路拼接”升级为“前后段都挂在统一编排与状态模型上”。
