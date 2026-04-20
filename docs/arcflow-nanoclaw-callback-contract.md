# ArcFlow NanoClaw Callback Contract

> 日期：2026-04-20
> 范围：ArcFlow Gateway 与 NanoClaw 非交互 `arcflow-*` skills 之间的 `workflow callback` 协议
> 说明：本文件是当前有效契约。若 skill 文档、历史 spec 或代码注释与本文冲突，以本文为准。

## 1. 包装层

所有回调都通过：

```text
POST {GATEWAY_URL}/api/workflow/callback
```

Header:

- `X-System-Secret: {NANOCLAW_DISPATCH_SECRET}`
- `Content-Type: application/json`

请求体统一使用以下 envelope：

```json
{
  "dispatch_id": "dispatch-123",
  "skill": "arcflow-prd-to-tech",
  "status": "success",
  "output": {}
}
```

失败回调：

```json
{
  "dispatch_id": "dispatch-123",
  "skill": "arcflow-prd-to-tech",
  "status": "failed",
  "error": "error message"
}
```

规则：

- `dispatch_id` 必填
- `skill` 必填
- `status` 只能是 `success` 或 `failed`
- `success` 时必须使用 `output`
- `failed` 时必须使用 `error`

## 2. `arcflow-prd-to-tech`

`status=success` 时，`output` 必须为：

```json
{
  "tech_doc_path": "tech-design/2026-04/demo.md",
  "content": "# Demo Tech Design",
  "plane_issue_id": "ISSUE-1"
}
```

字段要求：

- `tech_doc_path`: 必填，相对路径，不能是绝对路径，不能包含越界路径
- `content`: 必填，技术设计 Markdown 全文
- `plane_issue_id`: 选填

Gateway 行为：

- 校验路径合法性
- 将 `content` 写入 workspace docs repo 的 `tech_doc_path`

## 3. `arcflow-tech-to-openapi`

`status=success` 时，`output` 必须为：

```json
{
  "openapi_path": "api/2026-04/demo.yaml",
  "content": "openapi: 3.0.3",
  "plane_issue_id": "ISSUE-1"
}
```

字段要求：

- `openapi_path`: 必填，相对路径，不能是绝对路径，不能包含越界路径
- `content`: 必填，OpenAPI yaml 全文
- `plane_issue_id`: 选填

Gateway 行为：

- 校验路径合法性
- 将 `content` 写入 workspace docs repo 的 `openapi_path`
- 如 execution context 存在，继续触发 `code_gen`

## 4. `arcflow-bug-analysis`

`status=success` 时，`output` 必须为：

```json
{
  "summary": "编译失败",
  "root_cause": "缺少依赖",
  "suggested_fix": "补充依赖后重试",
  "confidence": "high",
  "next_action": "manual_handoff",
  "plane_issue_id": "ISSUE-3"
}
```

字段要求：

- `summary`: 必填
- `root_cause`: 必填
- `suggested_fix`: 必填
- `confidence`: 必填，只能是 `high`、`medium`、`low`
- `next_action`: 必填，只能是 `auto_fix_candidate`、`manual_handoff`
- `plane_issue_id`: 选填

Gateway 行为：

- 将结构化结果写入 `analysis_ready` 子任务摘要
- 更新 workflow detail 的 `bug_report_summary`
- 如 `plane_issue_id` 存在，则以 HTML 评论形式回写 Plane Issue

## 5. 失败语义

所有 `arcflow-*` 非交互 skill 在失败时统一回调：

```json
{
  "dispatch_id": "dispatch-123",
  "skill": "arcflow-tech-to-openapi",
  "status": "failed",
  "error": "error message"
}
```

Gateway 行为：

- 记录 dispatch 失败
- 如有 source execution，则将 execution 置为失败
- 不执行成功 side effect

## 6. 大 payload 传输方式

当 `output` 较大时，不应将完整 JSON 直接内联进 shell argv。

推荐方式：

1. 先把 payload 写入临时 JSON 文件
2. 使用 `arcflow-api workflow callback ... @/path/to/payload.json`

示例：

```bash
payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT

jq -n \
  --arg t "$tech_doc_path" \
  --rawfile c "$tech_doc_path" \
  --arg p "$plane_issue_id" \
  '{tech_doc_path:$t, content:$c, plane_issue_id:$p}' > "$payload_file"

arcflow-api workflow callback "$DISPATCH_ID" arcflow-prd-to-tech success "@$payload_file"
```

## 7. 兼容性原则

- 当前契约是严格契约，不再接受旧版 `content-only` 或 `JSON-in-content` 的 success payload
- 若未来需要改动字段，必须同步更新：
  - ArcFlow Gateway parser 与测试
  - NanoClaw CLI / skill 文档与测试
  - 本契约文档

## 8. 验证入口

ArcFlow 侧：

- `bun test packages/gateway/src/services/workflow-callback.test.ts`
- `bun test packages/gateway/src/services/workflow-writeback.test.ts`
- `bun test packages/gateway/src/services/plane.test.ts`

NanoClaw 侧：

- `npm test -- src/arcflow-api-cli.test.ts`
