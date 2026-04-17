> 文档状态：当前阶段验证报告。结论覆盖 2026-04-17 当前本地仓库状态；生产环境发布与手测仍需在可访问 `arcflow-server` 后补齐。

# arcflow-api Skill 联调与验收记录

- **日期**：2026-04-17
- **关联 Issue**：#119 `Phase 3.4b: 发布并接通 NanoClaw 仓内 arcflow-api skill 包`
- **验证范围**：ArcFlow Gateway 契约、Web artifact 渲染、NanoClaw `arcflow-api` skill 包本地接线
- **结论**：✅ **本地代码与契约已收口**；✅ **生产 NanoClaw 已完成发布与验收补证**

---

## 1. 本次补齐内容

### ArcFlow 仓

- `packages/gateway/src/routes/arcflow-tools.test.ts`
  - 补 `GET /api/arcflow/issues` 空结果边界
  - 补 `POST /api/arcflow/requirements/drafts` 在 `mode=created` 时返回 `201`
- `packages/web/src/components/AiArtifactCard.vue`
  - 新增 `arcflow_status` 专门渲染
  - 显示 `stage / progress / detail`
- `packages/web/src/components/AiArtifactCard.test.ts`
  - 补 `arcflow_status` 渲染测试

### NanoClaw 仓（`../nanoclaw` 当前工作树）

- `container/skills/arcflow-api/arcflow-api`
  - `issues my` 输出 `arcflow_card`
  - 空结果输出 `arcflow_status`
  - `requirements draft` 输出结构化 `arcflow_card`
- `src/structured-output.ts`
  - 解析 `===ARCFLOW_ARTIFACT_START=== ... ===ARCFLOW_ARTIFACT_END===`
  - 将 artifact 转回 WebChannel `artifact` 事件
- `src/arcflow-api-cli.test.ts`
  - 覆盖 `issues my`、`requirements draft`、空结果、Gateway 错误
- `src/structured-output.test.ts`
  - 覆盖显式 artifact marker 解析

---

## 2. 本地验证命令

已执行并通过：

```bash
cd ../nanoclaw
npx vitest run src/structured-output.test.ts src/arcflow-api-cli.test.ts

cd /Users/chenqi/code/ArcFlow/packages/gateway
bun test src/routes/arcflow-tools.test.ts

cd /Users/chenqi/code/ArcFlow/packages/web
npx vitest run src/components/AiArtifactCard.test.ts
```

### 结果摘要

| 组件 | 命令 | 结果 |
|---|---|---|
| NanoClaw | `npx vitest run src/structured-output.test.ts src/arcflow-api-cli.test.ts` | 2 files / 9 tests 通过 |
| Gateway | `bun test src/routes/arcflow-tools.test.ts` | 1 file / 4 tests 通过 |
| Web | `npx vitest run src/components/AiArtifactCard.test.ts` | 1 file / 2 tests 通过 |

---

## 3. 当前已确认的交互契约

### `issues my`

- 成功时返回自然语言摘要 + `arcflow_card`
- 空结果时返回自然语言摘要 + `arcflow_status`
- Gateway 错误时命令非零退出，并输出明确错误前缀

### `requirements draft`

- 默认 `dryRun: true`
- 执行 `--execute` 时发送 `dryRun: false`
- 返回结构化 `arcflow_card`
- ArcFlow Gateway 在 `mode=created` 时返回 `201`

### Web 渲染

- `arcflow_card`：展示字段与动作链接
- `arcflow_status`：展示阶段、百分比、详情

---

## 4. 生产发布记录

### 4.1 服务器连接与运行目录确认

- 服务器：`arcflow-server`（`172.29.230.21`）
- PM2 进程：`arcflow-nanoclaw`
- 运行目录：`/data/project/nanoclaw`

核验结果：

- `pm2 describe arcflow-nanoclaw` 显示 `script path=/data/project/nanoclaw/start.sh`
- `/data/project/nanoclaw` 为直接运行目录，不是 git worktree

### 4.2 发布内容

已同步到生产运行目录：

- `container/skills/arcflow-api/arcflow-api`
- `src/structured-output.ts`
- `src/structured-output.test.ts`
- `src/arcflow-api-cli.test.ts`
- `src/auth/credentials-file.ts`
- `groups/web/CLAUDE.md`

同时在生产机上为原有关键文件做了备份，备份时间戳：

- `20260417-101723`

### 4.3 生产机定向验证

已在服务器执行并通过：

```bash
cd /data/project/nanoclaw
npx vitest run src/structured-output.test.ts src/arcflow-api-cli.test.ts
npm run build
pm2 restart arcflow-nanoclaw
```

验证结果：

- NanoClaw 定向测试：`2 files / 9 tests` 通过
- 宿主进程重建并重启成功
- `pm2 list` 中 `arcflow-nanoclaw` 状态为 `online`

---

## 5. 生产问题与修复

### 5.1 问题一：agent 容器内缺少 `jq`

现象：

- 真实 Web 会话中，NanoClaw 已调用 `arcflow-api`
- 但 agent 容器会尝试临时安装 `jq`，导致链路延迟和不稳定

定位：

- 生产 `nanoclaw-agent:latest` 镜像内 `jq` 缺失
- `arcflow-api` 的 `issues my` / `requirements draft` 关键路径原先依赖 `jq`

修复：

- 将 `arcflow-api` 的 `issues my` 与 `requirements draft` 关键 JSON 处理改为使用 `node`
- 避免这两条最小能力链路依赖 `jq`

### 5.2 问题二：容器内无法读取 ArcFlow 凭证

现象：

- 真实 Web 会话中出现：
  - `The credentials file at /run/arcflow/credentials.json is only readable by root`
- 导致 `arcflow-api` 无法读取 token 和 gateway URL

根因：

- `src/auth/credentials-file.ts` 将凭证文件写成 `0400`
- agent 容器运行用户不是 root，无法读取

修复：

- 将权限改为 `0444`
- 新增测试：`src/auth/credentials-file.test.ts`

本地验证：

```bash
cd ../nanoclaw
npx vitest run src/auth/credentials-file.test.ts
```

结果：`1 file / 1 test` 通过

### 5.3 问题三：Web 组提示词未启用 ArcFlow 专用路由规则

现象：

- `groups/web/CLAUDE.md` 原先是通用 Andy 模板
- 普通 Web 会话下，agent 不稳定地保留 `arcflow-api` 的原始 stdout
- 结构化标记容易被总结掉，导致 Web 看不到 artifact

修复：

- 新增/同步 `groups/web/CLAUDE.md`
- 明确：
  - ArcFlow 请求优先走 `arcflow-api`
  - `issues my` / `requirements draft` 需要保留命令原始 stdout
  - 让 `arcflow_card / arcflow_status` 标记可被 Web 侧解析

---

## 6. 真实环境验收结果

### 6.1 真实 issue 查询

使用真实 WebChannel 与生产 NanoClaw / Gateway 做了验证。

可确认的真实 SSE 证据：

- `skill_loaded: arcflow-api`
- `artifact: arcflow_status`

对应 artifact 负载：

```json
{
  "id": "issues-empty",
  "type": "arcflow_status",
  "title": "暂无待处理 Issue",
  "content": "{\"stage\":\"empty\",\"progress\":100,\"detail\":\"当前没有分配给你的 Issue\"}"
}
```

结论：

- `Web -> NanoClaw -> Gateway` 真实链路已完成一次 issue 查询
- 结果已被 WebChannel 识别为结构化 artifact

### 6.2 真实 requirements draft dry-run

真实 WebChannel SSE 中已拿到：

- `skill_loaded: arcflow-api`
- `artifact: arcflow_card`

对应 artifact 标题：

- `需求草稿预览`

对应 artifact 中包含：

- `路径`
- `模式=dry_run`
- `预览`
- `查看文档`

结论：

- `requirements draft` dry-run 已在真实环境输出结构化 card artifact

### 6.3 真实 requirements draft execute

执行确认后，已在 docs Git workdir 中观察到真实新文件和提交：

```text
eaed255 feat(requirement): 新增 Codex 联调需求草稿 草稿
```

真实文件路径：

- `requirements/2026-04/codex-联调需求草稿.md`

文件内容已落盘，可读取到：

```md
# Codex 联调需求草稿

## 背景

用于验证 issue 119 的真实 requirements draft execute 链路
```

结论：

- `requirements draft --execute` 已在真实环境完成创建写入

---

## 7. 最终结论

`#119` 关注的最小闭环已在生产环境完成补证：

1. ArcFlow Web AiChat 可通过 NanoClaw 发起真实 issue 查询
2. 结果可在 WebChannel 中回流为 `arcflow_status` artifact
3. ArcFlow Web AiChat 可完成真实 `requirements draft` dry-run
4. dry-run 结果可在 WebChannel 中回流为 `arcflow_card`
5. 确认后可真实执行创建，并在 docs Git workdir 中落盘为新文件

剩余注意事项：

- 生产 `nanoclaw-agent:latest` 镜像仍未重建到包含 `jq` 的版本；本次通过让 `arcflow-api` 最小路径脱离 `jq` 依赖完成收口
- 若后续要让更多 shell skill 稳定运行，仍建议单独重建 agent image
