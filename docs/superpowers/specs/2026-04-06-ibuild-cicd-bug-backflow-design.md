# iBuild CI/CD Bug 回流自动化 — 设计规格

> Issue: #35  
> 日期: 2026-04-06  
> 状态: 设计完成

## 1. 背景

ArcFlow Gateway 已实现完整的 bug_analysis 工作流（Dify 分析 → Plane Bug Issue → Claude Code 自动修复 → 飞书通知），但缺少 CI 侧的触发入口。内网使用自研 iBuild 构建系统，需要对接其 Webhook 和 API 实现构建失败 → 自动 Bug 分析的闭环。

## 2. 整体数据流

```text
iBuild Webhook (URL-encoded, 构建完成回调)
  → Gateway POST /webhook/ibuild
  → 解析 status，仅 FAIL / ABORT 触发：
    → 从 gitBranch 正则提取 Plane Issue ID
    → 调用 iBuild API (accessToken 认证) 获取构建详情
    → 通过 logUrl 拉取构建日志
    → 触发已有 bug_analysis 工作流
      → Dify 分析日志 → 创建 Plane Bug Issue
      → Claude Code 自动修复（最多 2 次）
      → 超限升级 P0 飞书通知
```

## 3. iBuild Webhook 端点

### 3.1 端点

`POST /webhook/ibuild`

### 3.2 Payload 格式

URL-encoded form data，关键字段：

| 字段 | 示例 | 用途 |
|------|------|------|
| `status` | PROCESSING / SUCCEED / FAIL / ABORT / CANCEL | 构建状态 |
| `buildId` | 1661 | 构建号，用于调 API 拉详情 |
| `projectId` | 90dab3ac... | iBuild 项目 ID |
| `appId` | 3fbb203a... | iBuild 应用 ID |
| `gitBranch` | feat/ISSUE-123-add-login | 分支名，用于提取 Plane Issue ID |
| `commitId` | b2140960 | 提交短 hash |
| `projectKey` | CSXMZHZHAI2 | 项目标识 |
| `appKey` | DZHCS | 应用标识 |
| `builder` | zhzhai2 | 构建触发者 |
| `startTime` | 2025-05-29 20:23:58 | 构建开始时间 |

### 3.3 处理逻辑

1. **解析**：URL-encoded body → 提取 status, buildId, projectId, appId, gitBranch, commitId
2. **状态过滤**：仅 `FAIL` 或 `ABORT` 继续，其他返回 `{ received: true, triggered: false }`
3. **Issue ID 提取**：从 gitBranch 提取 Plane Issue ID（见第 5 节，统一正则）
   - 匹配成功：第一个捕获组作为 `plane_issue_id`
   - 匹配失败：`plane_issue_id` 为空，仍触发 Bug 分析（不创建关联 Issue，仅分析 + 通知）
4. **异步触发**：调用 iBuild API 获取日志 → 触发 bug_analysis 工作流（fire-and-forget）
   - `trigger_source` 使用新增的 `"ibuild_webhook"`
   - `project_id` 使用配置项 `PLANE_DEFAULT_PROJECT_ID`（见第 6 节），因为 iBuild projectId ≠ Plane project ID
   - `target_repos` 使用配置项映射或默认 `"backend"`（见第 5.4 节）
5. **响应**：立即返回 `{ received: true, triggered: true }`

### 3.4 验证方式

iBuild Webhook 无 HMAC 签名机制，采用 URL query param 共享 secret：

- Webhook 配置 URL：`https://gateway/webhook/ibuild?secret=xxx`
- Gateway 校验 `c.req.query("secret") === config.ibuildWebhookSecret`
- 不复用现有 `createWebhookVerifier`（它基于 HMAC header），在路由 handler 内联校验 query param

### 3.5 去重

现有 `createDedup` 从 HTTP header 读取事件 ID，但 iBuild 的 `buildId` 在 form body 中。处理方式：

- 在路由 handler 中解析 body 后，手动调用 dedup 逻辑（查询 `webhook_event` 表，插入 `buildId` + `"ibuild"` source）
- 不复用 `createDedup` 中间件（它在 body 解析前执行，无法读取 form 字段）

## 4. iBuild 服务层

### 4.1 文件

`src/services/ibuild.ts`

### 4.2 接口

```typescript
interface IBuildService {
  /** 获取 accessToken，内部缓存至过期前 5 分钟 */
  getAccessToken(): Promise<string>;

  /** 调用 API #6 获取构建详情（含 modules 状态列表） */
  getBuildDetail(projectId: string, appId: string, buildSid: string): Promise<IBuildDetail>;

  /** 通过 logUrl 拉取构建日志纯文本 */
  getBuildLog(logUrl: string): Promise<string>;
}
```

### 4.3 Token 管理

- 调用 CS API：`POST {IBUILD_BASE_URL}/restapi/cs/v1/auth/accessToken`
- 请求体：`{ clientKey, user, expire: "1440" }`（24 小时）
- 缓存 token 在内存，记录过期时间
- 每次调用前检查：距过期不足 5 分钟则刷新
- 请求头：`accessToken: {token}`（注意：不能同时带 `token` header）

### 4.4 构建详情 API

- `GET {IBUILD_BASE_URL}/restapi/ibuild/v1/projects/{projectId}/applications/{appId}/buildstatusdetail?buildSid={buildSid}`
- 返回 `obj` 包含 `status`, `modules[]`, `branch`, `commitNum` 等
- 从 `modules` 中找到 `status: "FAIL"` 的模块确定失败环节

### 4.5 日志拉取

- `logUrl` 是相对路径（如 `/ClientAppLog?uuid=...`）
- 拼接：`{IBUILD_BASE_URL}{logUrl}`
- 携带 accessToken header
- 返回纯文本日志
- **日志截断**：超过 100KB 时，保留最后 100KB（尾部通常包含错误摘要和失败堆栈），并在头部标注 `[日志已截断，仅保留最后 100KB]`

### 4.6 构建详情中的失败模块

调用 `getBuildDetail` 后，从 `modules[]` 中筛选 `status: "FAIL"` 的模块，将失败模块名称拼入传递给 Dify 的日志上下文前缀：

```text
失败构建模块：Maven, SonarQube
---
[构建日志内容]
```

这有助于 Dify 聚焦分析失败环节，提高 Bug 报告准确度。

### 4.7 错误处理

- Token 获取失败 → 抛出错误，workflow 记录为 failed
- API 调用失败 → 复用 Gateway 已有的 retry 逻辑（2 次重试，指数退避）

## 5. Branch → Plane Issue ID 关联

### 5.1 命名约定

ArcFlow 管理的分支统一使用：`{type}/{planeIssueId}-{description}`

- `feat/PROJ-123-add-login`
- `fix/PROJ-456-fix-crash`
- `hotfix/PROJ-789-urgent-patch`

### 5.2 提取正则

```typescript
const BRANCH_ISSUE_REGEX = /^(?:feat|fix|hotfix|feature)\/([A-Z]+-\d+)/;
```

假设 Plane Issue ID 格式为 `{大写前缀}-{数字}`（如 `PROJ-123`），正则直接匹配这个模式。

**测试用例：**

| 输入分支名 | 期望捕获 |
|---|---|
| `feat/PROJ-123-add-login` | `PROJ-123` |
| `fix/PROJ-456-fix-crash` | `PROJ-456` |
| `hotfix/PROJ-789-urgent-patch` | `PROJ-789` |
| `feature/BUG-42` | `BUG-42` |
| `master` | 无匹配 |
| `develop` | 无匹配 |
| `release/v1.0` | 无匹配 |

### 5.3 降级策略

提取失败时（如 `master`、`develop` 或不规范的分支名）：

- `plane_issue_id` 设为空
- 仍触发 bug_analysis 工作流
- Dify 分析日志 → 飞书通知团队
- 不创建 Plane Bug Issue（因无法关联父 Issue）

### 5.4 target_repos 映射

iBuild Webhook 中的 `appKey` 可映射到 ArcFlow 管理的目标仓库。新增配置项 `IBUILD_APP_REPO_MAP`（JSON 格式）：

```json
{ "DZHCS": "backend", "DZHCS_WEB": "vue3", "DZHCS_APP": "flutter" }
```

查找逻辑：`config.ibuildAppRepoMap[appKey] ?? "backend"`

## 6. 配置项

新增到 `src/config.ts`：

| 变量 | 说明 | 示例 |
|------|------|------|
| `IBUILD_BASE_URL` | iBuild API 基础地址 | `http://console.devops.iflytek.com` |
| `IBUILD_CLIENT_KEY` | API 认证 clientKey | `CD523BBA47CB...` |
| `IBUILD_USER` | 域账号 | `qichen22` |
| `IBUILD_WEBHOOK_SECRET` | Webhook URL 共享密钥 | 随机字符串 |
| `IBUILD_APP_REPO_MAP` | appKey → 仓库名映射 (JSON) | `{"DZHCS":"backend"}` |
| `PLANE_DEFAULT_PROJECT_ID` | 默认 Plane 项目 ID（iBuild 触发时使用） | `proj-xxxxx` |

## 7. 改动范围

### 7.1 新增文件

| 文件 | 内容 |
|------|------|
| `src/services/ibuild.ts` | iBuild API 客户端 |
| `src/services/ibuild.test.ts` | 单元测试 |

### 7.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/routes/webhook.ts` | 新增 `/webhook/ibuild` 端点 |
| `src/routes/webhook.test.ts` | 补充 ibuild webhook 测试 |
| `src/config.ts` | 新增 6 个配置项（5 个 iBuild + 1 个 Plane） |
| `src/types/index.ts` | 新增 IBuildDetail 等类型，WebhookSource 加 `"ibuild"`，TriggerSource 加 `"ibuild_webhook"` |

### 7.3 不修改

| 文件 | 原因 |
|------|------|
| `src/services/workflow.ts` | bug_analysis 工作流已完整，直接复用 |
| `src/routes/webhook.ts` 的 `/webhook/cicd` | 保持作为通用 JSON CI 接口 |

## 8. 测试策略

### 8.1 IBuild Service 测试

- Token 申请成功 + 缓存命中 + 过期刷新
- 构建详情解析（正常 / 空响应 / 网络错误）
- 日志拉取（正常 / logUrl 为空 / 超大日志截断）
- API 重试机制

### 8.2 Webhook 端点测试

- URL-encoded body 正确解析
- 状态过滤：FAIL/ABORT 触发 vs SUCCEED/PROCESSING/CANCEL 忽略
- Branch 正则提取：标准格式 / 非标准格式降级
- Secret 校验：正确 / 缺失 / 错误
- 去重：重复 buildId 只处理一次

### 8.3 集成测试

- Webhook → IBuild API mock → bug_analysis 完整链路
- 日志拉取失败时的错误处理路径
